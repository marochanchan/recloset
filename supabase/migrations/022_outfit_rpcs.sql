-- =========================================
-- Re:Closet: コーデの下書きと確定・編集の RPC
--
-- ユーザー向けの RPC（authenticated にだけ execute を許可する）:
--   public.create_outfit_draft(p_client_request_id, p_worn_on, p_source) returns public.outfits
--   public.confirm_outfit(p_outfit_id, p_expected_revision, p_worn_on, p_item_ids, p_note) returns jsonb
--   public.delete_outfit(p_outfit_id) returns void
--   public.record_wear_today(p_item_id) returns jsonb   -- {created: boolean}
--   public.hard_delete_item(p_item_id) returns void
-- 内部用（どのロールにも execute を与えない）:
--   public.enqueue_media_deletion(p_user, p_provider, p_asset_id) returns void
--
-- 方針:
-- - ユーザーは auth.uid() から決める（引数で受け取らない）。null なら not_authenticated
-- - どちらも最初に outfit_lock_user(auth.uid()) でユーザー単位の排他を取る。
--   同じ人の確定・編集・（のちの）削除は、この1本のロックで順番に処理される
-- - 例外は errcode + 固定の message（outfit_not_found / item_not_found /
--   invalid_revision / not_authenticated）。Task 6b も同じものを使う
-- - 「記録をつなぐ」: その服の、新しい日付（日本時間）の wear_today の記録で、どの outfit_items
--   からも参照されていないものがあれば、いちばん古いものを使う。なければ source=outfit の
--   記録（worn_at = outfit_worn_at(新しい日付)）を作る
-- - security definer + set search_path = ''。テーブル・関数は schema 付きで書く
--
-- 適用: Supabase SQL Editor で、このファイル全体を1回だけ実行する（begin〜commit の1トランザクション）
-- =========================================
begin;

-- -----------------------------------------
-- 「記録をつなぐ」の部品（内部用。どのロールにも execute を与えない）
-- 未使用の wear_today の記録の id を返す（なければ null）
-- -----------------------------------------
create or replace function public.outfit_find_unused_wear_today(p_item_id uuid, p_worn_on date)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select wl.id
    from public.wear_logs wl
   where wl.clothing_item_id = p_item_id
     and wl.source = 'wear_today'
     and public.jst_date(wl.worn_at) = p_worn_on
     and not exists (select 1 from public.outfit_items oi where oi.wear_log_id = wl.id)
   order by wl.worn_at, wl.id
   limit 1;
$$;

-- -----------------------------------------
-- create_outfit_draft
-- -----------------------------------------
create or replace function public.create_outfit_draft(
  p_client_request_id uuid,
  p_worn_on date,
  p_source text
)
returns public.outfits
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.outfits;
begin
  if v_uid is null then
    raise exception using errcode = '28000', message = 'not_authenticated';
  end if;
  perform public.outfit_lock_user(v_uid);

  -- 同じ (user_id, client_request_id) があれば、それを返す（再送しても1件）
  if p_client_request_id is not null then
    select * into v_row
      from public.outfits
     where user_id = v_uid and client_request_id = p_client_request_id;
    if found then
      return v_row;
    end if;
  end if;

  -- p_source は outfits_source_check で確かめられる
  insert into public.outfits (user_id, worn_on, source, client_request_id)
  values (v_uid, p_worn_on, p_source, p_client_request_id)
  returning * into v_row;
  return v_row;
end;
$$;

-- -----------------------------------------
-- confirm_outfit
-- -----------------------------------------
create or replace function public.confirm_outfit(
  p_outfit_id uuid,
  p_expected_revision integer,
  p_worn_on date,
  p_item_ids uuid[],
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid       uuid := auth.uid();
  v_outfit    public.outfits;
  v_new       uuid[];   -- 新しい服（重複なし）
  v_cur       uuid[];   -- 今の服
  v_remove    uuid[];   -- 外す服
  v_add       uuid[];   -- 足す服
  v_months    date[];   -- 影響する月（月初）
  v_rev       integer;
  v_item      uuid;
  v_oi        public.outfit_items;
  v_cur_log   public.wear_logs;
  v_log_id    uuid;
  v_month     date;
begin
  if v_uid is null then
    raise exception using errcode = '28000', message = 'not_authenticated';
  end if;

  -- 1. expected が null か負なら invalid_revision。ロックして行を取る
  if p_expected_revision is null or p_expected_revision < 0 then
    raise exception using errcode = '22023', message = 'invalid_revision';
  end if;

  perform public.outfit_lock_user(v_uid);

  select * into v_outfit
    from public.outfits
   where id = p_outfit_id and user_id = v_uid
     for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'outfit_not_found';
  end if;

  -- 今より新しい版は、中身が同じでも invalid_revision（3 の unchanged より先に確かめる）
  if p_expected_revision > v_outfit.revision then
    raise exception using errcode = '22023', message = 'invalid_revision';
  end if;

  -- 2. 新しい服は、すべて本人の服であること。足す服はしまった服でないこと
  select coalesce(array_agg(x order by x), '{}') into v_new
    from (select distinct x from unnest(coalesce(p_item_ids, '{}'::uuid[])) as t(x)) d;

  select coalesce(array_agg(oi.item_id order by oi.item_id), '{}') into v_cur
    from public.outfit_items oi
   where oi.outfit_id = p_outfit_id;

  v_remove := array(select unnest(v_cur) except select unnest(v_new));
  v_add    := array(select unnest(v_new) except select unnest(v_cur));

  -- null の id も、数が合わなくなるので item_not_found になる
  if (select count(*) from public.clothing_items ci
       where ci.user_id = v_uid and ci.id = any(v_new)) <> cardinality(v_new) then
    raise exception using errcode = 'P0002', message = 'item_not_found';
  end if;
  if exists (select 1 from public.clothing_items ci
              where ci.user_id = v_uid and ci.id = any(v_add) and ci.archived_at is not null) then
    raise exception using errcode = 'P0002', message = 'item_not_found';
  end if;

  -- 3. 確定済みで、日付・服の集合・note が今と同じなら unchanged（古い expected でもよい）
  if v_outfit.status = 'confirmed'
     and v_outfit.worn_on is not distinct from p_worn_on
     and v_cur = v_new
     and v_outfit.note is not distinct from p_note then
    return jsonb_build_object('status', 'unchanged', 'revision', v_outfit.revision);
  end if;

  -- 4. 古い版からの別の内容は stale
  if p_expected_revision < v_outfit.revision then
    return jsonb_build_object('status', 'stale', 'revision', v_outfit.revision);
  end if;

  -- 5. 影響する月（月初）= 元の worn_on の月（確定済みのとき）と、新しい worn_on の月
  v_months := array[date_trunc('month', p_worn_on::timestamp)::date];
  if v_outfit.status = 'confirmed' then
    v_months := v_months || date_trunc('month', v_outfit.worn_on::timestamp)::date;
  end if;

  -- 6. 外す服: outfit_items の行を消す。つながっていた記録が source=outfit なら、その記録も消す
  --    （wear_today の記録は残す）
  for v_oi in
    select * from public.outfit_items
     where outfit_id = p_outfit_id and item_id = any(v_remove)
  loop
    delete from public.outfit_items
     where outfit_id = v_oi.outfit_id and item_id = v_oi.item_id;
    if v_oi.wear_log_id is not null then
      delete from public.wear_logs where id = v_oi.wear_log_id and source = 'outfit';
    end if;
  end loop;

  -- 7. 残す服: 記録の日付が新しい worn_on と違う（日付を変えた）ときだけつなぎ直す。
  --    記録がまだない行（確認待ちの検出など）も同じ扱いで、必ず記録をつなぐ
  for v_oi in
    select * from public.outfit_items
     where outfit_id = p_outfit_id and item_id = any(v_new) and item_id <> all(v_add)
  loop
    select * into v_cur_log from public.wear_logs where id = v_oi.wear_log_id;
    continue when found and public.jst_date(v_cur_log.worn_at) = p_worn_on;

    v_log_id := public.outfit_find_unused_wear_today(v_oi.item_id, p_worn_on);
    if v_log_id is not null then
      -- 新しい日の wear_today につなぎ替える。今の記録が source=outfit なら消す
      update public.outfit_items set wear_log_id = v_log_id, updated_at = now()
       where outfit_id = v_oi.outfit_id and item_id = v_oi.item_id;
      if v_cur_log.id is not null and v_cur_log.source = 'outfit' then
        delete from public.wear_logs where id = v_cur_log.id;
      end if;
    elsif v_cur_log.id is not null and v_cur_log.source = 'outfit' then
      -- 新しい記録は作らず、worn_at を直す
      update public.wear_logs set worn_at = public.outfit_worn_at(p_worn_on) where id = v_cur_log.id;
    else
      -- wear_today の記録は残してつながりを外し、source=outfit の記録を作ってつなぐ
      update public.outfit_items set wear_log_id = null, updated_at = now()
       where outfit_id = v_oi.outfit_id and item_id = v_oi.item_id;
      insert into public.wear_logs (clothing_item_id, worn_at, source)
      values (v_oi.item_id, public.outfit_worn_at(p_worn_on), 'outfit')
      returning id into v_log_id;
      update public.outfit_items set wear_log_id = v_log_id, updated_at = now()
       where outfit_id = v_oi.outfit_id and item_id = v_oi.item_id;
    end if;
  end loop;

  -- 8. 足す服: outfit_items の行を作り（source='manual'）、記録をつなぐ
  foreach v_item in array v_add loop
    v_log_id := public.outfit_find_unused_wear_today(v_item, p_worn_on);
    if v_log_id is null then
      insert into public.wear_logs (clothing_item_id, worn_at, source)
      values (v_item, public.outfit_worn_at(p_worn_on), 'outfit')
      returning id into v_log_id;
    end if;
    insert into public.outfit_items (outfit_id, item_id, user_id, wear_log_id, source)
    values (p_outfit_id, v_item, v_uid, v_log_id, 'manual');
  end loop;

  -- 9. outfits を更新する
  update public.outfits
     set status = 'confirmed',
         worn_on = p_worn_on,
         note = p_note,
         revision = revision + 1,
         confirmed_at = coalesce(confirmed_at, now()),
         updated_at = now()
   where id = p_outfit_id
  returning revision into v_rev;

  -- 10. 派生値を作り直す（今の服 ∪ 新しい服の wear_count / last_worn_at、影響する月のサマリー）
  perform public.recompute_item_wear(v_cur || v_new);
  for v_month in select distinct unnest(v_months) loop
    perform public.rebuild_monthly_stats(v_uid, v_month);
  end loop;

  -- 11.
  return jsonb_build_object('status', 'confirmed', 'revision', v_rev);
end;
$$;

-- -----------------------------------------
-- enqueue_media_deletion（内部用。どのロールにも execute を与えない。Task 7 も使う）
-- 外部（Cloudflare）のメディアの削除待ちに入れる。同じ asset がすでにあれば何もしない
-- -----------------------------------------
create or replace function public.enqueue_media_deletion(p_user uuid, p_provider text, p_asset_id text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.media_deletion_queue (user_id, provider, provider_asset_id)
  values (p_user, p_provider, p_asset_id)
  on conflict (provider, provider_asset_id) do nothing;
$$;

-- -----------------------------------------
-- delete_outfit
-- source=outfit の記録は消し、wear_today の記録は残す（つながりだけ外れる）
-- -----------------------------------------
create or replace function public.delete_outfit(p_outfit_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_outfit public.outfits;
  v_items  uuid[];
  v_months date[];
  v_media  record;
  v_month  date;
begin
  if v_uid is null then
    raise exception using errcode = '28000', message = 'not_authenticated';
  end if;
  perform public.outfit_lock_user(v_uid);

  select * into v_outfit
    from public.outfits
   where id = p_outfit_id and user_id = v_uid
     for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'outfit_not_found';
  end if;

  -- 影響する服と月（コーデの日付の月と、つながった記録の月）を、消す前に集める
  select coalesce(array_agg(oi.item_id), '{}') into v_items
    from public.outfit_items oi where oi.outfit_id = p_outfit_id;

  select coalesce(array_agg(distinct m), '{}') into v_months
    from (
      select date_trunc('month', v_outfit.worn_on::timestamp)::date as m
      union
      select date_trunc('month', public.jst_date(wl.worn_at)::timestamp)::date
        from public.outfit_items oi
        join public.wear_logs wl on wl.id = oi.wear_log_id
       where oi.outfit_id = p_outfit_id
    ) x;

  -- source=outfit の記録を消す（wear_today の記録は残す）
  delete from public.wear_logs wl
   using public.outfit_items oi
   where oi.outfit_id = p_outfit_id
     and oi.wear_log_id = wl.id
     and wl.source = 'outfit';

  -- メディアを外部の削除待ちに入れる
  for v_media in
    select provider, provider_asset_id from public.outfit_media where outfit_id = p_outfit_id
  loop
    perform public.enqueue_media_deletion(v_uid, v_media.provider, v_media.provider_asset_id);
  end loop;

  -- outfit_media と outfit_items は cascade で消える
  delete from public.outfits where id = p_outfit_id;

  perform public.recompute_item_wear(v_items);
  for v_month in select unnest(v_months) loop
    perform public.rebuild_monthly_stats(v_uid, v_month);
  end loop;
end;
$$;

-- -----------------------------------------
-- record_wear_today
-- 日本時間の今日の記録がすでにあれば作らない。worn_at は now()
-- -----------------------------------------
create or replace function public.record_wear_today(p_item_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception using errcode = '28000', message = 'not_authenticated';
  end if;
  perform public.outfit_lock_user(v_uid);

  if not exists (select 1 from public.clothing_items ci
                  where ci.id = p_item_id and ci.user_id = v_uid and ci.archived_at is null) then
    raise exception using errcode = 'P0002', message = 'item_not_found';
  end if;

  if exists (select 1 from public.wear_logs wl
              where wl.clothing_item_id = p_item_id
                and public.jst_date(wl.worn_at) = public.jst_date(now())) then
    return jsonb_build_object('created', false);
  end if;

  insert into public.wear_logs (clothing_item_id, worn_at, source)
  values (p_item_id, now(), 'wear_today');

  perform public.recompute_item_wear(array[p_item_id]);
  perform public.rebuild_monthly_stats(v_uid, date_trunc('month', public.jst_date(now())::timestamp)::date);
  return jsonb_build_object('created', true);
end;
$$;

-- -----------------------------------------
-- hard_delete_item
-- 服を完全に消す。コーデは残す（その服の outfit_items の行だけ消える）
-- -----------------------------------------
create or replace function public.hard_delete_item(p_item_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_months date[];
  v_month  date;
begin
  if v_uid is null then
    raise exception using errcode = '28000', message = 'not_authenticated';
  end if;
  perform public.outfit_lock_user(v_uid);

  if not exists (select 1 from public.clothing_items ci
                  where ci.id = p_item_id and ci.user_id = v_uid) then
    raise exception using errcode = 'P0002', message = 'item_not_found';
  end if;

  -- 影響する月（記録の月と、確定済みコーデの月）を、消す前に集める
  select coalesce(array_agg(distinct m), '{}') into v_months
    from (
      select date_trunc('month', public.jst_date(wl.worn_at)::timestamp)::date as m
        from public.wear_logs wl where wl.clothing_item_id = p_item_id
      union
      select date_trunc('month', o.worn_on::timestamp)::date
        from public.outfit_items oi
        join public.outfits o on o.id = oi.outfit_id
       where oi.item_id = p_item_id and o.status = 'confirmed'
    ) x;

  -- (item_id, user_id) の外部キーは restrict なので、先に outfit_items の行を消す
  delete from public.outfit_items where item_id = p_item_id and user_id = v_uid;
  -- 着用記録は cascade で消える
  delete from public.clothing_items where id = p_item_id and user_id = v_uid;

  for v_month in select unnest(v_months) loop
    perform public.rebuild_monthly_stats(v_uid, v_month);
  end loop;
end;
$$;

-- -----------------------------------------
-- 権限: 同じトランザクションで取り上げてから、必要な分だけ与える
-- -----------------------------------------
revoke all on function public.outfit_find_unused_wear_today(uuid, date)
  from public, anon, authenticated, service_role;
revoke all on function public.create_outfit_draft(uuid, date, text)
  from public, anon, authenticated, service_role;
revoke all on function public.confirm_outfit(uuid, integer, date, uuid[], text)
  from public, anon, authenticated, service_role;
revoke all on function public.enqueue_media_deletion(uuid, text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.delete_outfit(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.record_wear_today(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.hard_delete_item(uuid)
  from public, anon, authenticated, service_role;

grant execute on function public.create_outfit_draft(uuid, date, text) to authenticated;
grant execute on function public.confirm_outfit(uuid, integer, date, uuid[], text) to authenticated;
grant execute on function public.delete_outfit(uuid) to authenticated;
grant execute on function public.record_wear_today(uuid) to authenticated;
grant execute on function public.hard_delete_item(uuid) to authenticated;
-- enqueue_media_deletion は内部用。どのロールにも execute を与えない

commit;
