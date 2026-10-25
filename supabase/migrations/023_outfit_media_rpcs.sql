-- =========================================
-- Re:Closet: メディアと削除待ちの RPC（サーバー専用）
--
-- すべてサーバー専用（service_role にだけ execute を許可する）:
--   public.register_outfit_media(p_user_id, p_media_id, p_outfit_id, p_kind, p_provider, p_asset_id,
--                                p_upload_expires_at, p_taken_at, p_sort_order) returns public.outfit_media
--   public.replace_outfit_media_asset(p_user_id, p_media_id, p_expected_upload_attempt, p_asset_id,
--                                     p_upload_expires_at) returns public.outfit_media
--   public.set_outfit_media_state(p_user_id, p_media_id, p_expected_upload_attempt, p_status,
--                                 p_width, p_height, p_duration_sec) returns public.outfit_media
--   public.apply_stream_webhook(p_asset_id, p_status, p_width, p_height, p_duration_sec) returns text
--   public.claim_media_deletions(p_limit) returns setof public.media_deletion_queue
--   public.finish_media_deletion(p_id, p_claim_token, p_ok, p_error) returns boolean
--
-- 方針:
-- - どれも最初に、持ち主のユーザーで outfit_lock_user を取る（apply_stream_webhook は行から持ち主を導く）
-- - 例外は errcode + 固定の message（outfit_not_found / media_not_found / media_conflict /
--   media_attempt_changed / invalid_media_transition / invalid_media_status）
-- - p_expected_upload_attempt が今の upload_attempt と違えば media_attempt_changed
--   （別の処理が先に置き換えた。確かめた実体はもう今の試行ではない）
-- - processing / ready のメディアは replace しない（届いた写真を消さない）
-- - 削除待ちの claim は for update skip locked。finish は照合と更新を1文で行う
-- - security definer + set search_path = ''。テーブル・関数は schema 付きで書く
--
-- 適用: Supabase SQL Editor で、このファイル全体を1回だけ実行する（begin〜commit の1トランザクション）
-- =========================================
begin;

-- -----------------------------------------
-- register_outfit_media
-- -----------------------------------------
create or replace function public.register_outfit_media(
  p_user_id uuid,
  p_media_id uuid,
  p_outfit_id uuid,
  p_kind text,
  p_provider text,
  p_asset_id text,
  p_upload_expires_at timestamptz,
  p_taken_at timestamptz,
  p_sort_order integer
)
returns public.outfit_media
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.outfit_media;
begin
  perform public.outfit_lock_user(p_user_id);

  perform 1 from public.outfits where id = p_outfit_id and user_id = p_user_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'outfit_not_found';
  end if;

  select * into v_row from public.outfit_media where id = p_media_id;
  if found then
    -- 他人の行、または別のコーデ・種類・プロバイダーの行は使い回させない
    if v_row.user_id <> p_user_id or v_row.outfit_id <> p_outfit_id
       or v_row.kind <> p_kind or v_row.provider <> p_provider then
      raise exception using errcode = 'P0001', message = 'media_conflict';
    end if;
    -- すべて同じなら何も変えずに返す（provider_asset_id は呼んだ側と違うことがある）
    return v_row;
  end if;

  insert into public.outfit_media
    (id, user_id, outfit_id, kind, provider, provider_asset_id, upload_expires_at, taken_at, sort_order)
  values
    (p_media_id, p_user_id, p_outfit_id, p_kind, p_provider, p_asset_id, p_upload_expires_at, p_taken_at,
     coalesce(p_sort_order, 0))
  returning * into v_row;

  -- 最初の写真を解析に使うメディアにする
  if p_kind = 'photo' then
    update public.outfits
       set analysis_media_id = p_media_id
     where id = p_outfit_id and analysis_media_id is null;
  end if;

  return v_row;
end;
$$;

-- -----------------------------------------
-- replace_outfit_media_asset
-- -----------------------------------------
create or replace function public.replace_outfit_media_asset(
  p_user_id uuid,
  p_media_id uuid,
  p_expected_upload_attempt integer,
  p_asset_id text,
  p_upload_expires_at timestamptz
)
returns public.outfit_media
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.outfit_media;
begin
  perform public.outfit_lock_user(p_user_id);

  select * into v_row
    from public.outfit_media
   where id = p_media_id and user_id = p_user_id
     for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'media_not_found';
  end if;

  if v_row.upload_attempt is distinct from p_expected_upload_attempt then
    raise exception using errcode = 'P0001', message = 'media_attempt_changed';
  end if;

  -- 届いた写真を消さない。何も変えず、削除待ちにも入れない
  if v_row.status in ('processing', 'ready') then
    return v_row;
  end if;

  -- uploading / failed: 古い ID を削除待ちに入れて、新しい ID に置き換える
  perform public.enqueue_media_deletion(p_user_id, v_row.provider, v_row.provider_asset_id);

  update public.outfit_media
     set provider_asset_id = p_asset_id,
         upload_attempt    = upload_attempt + 1,
         -- 前の試行の寸法・長さは新しい実体に持ち越さない
         width             = null,
         height            = null,
         duration_sec      = null,
         upload_expires_at = p_upload_expires_at,
         status            = 'uploading',
         updated_at        = now()
   where id = p_media_id
  returning * into v_row;
  return v_row;
end;
$$;

-- -----------------------------------------
-- set_outfit_media_state
-- 許可: uploading → processing|ready|failed、processing → processing|ready|failed、ready → ready
-- -----------------------------------------
create or replace function public.set_outfit_media_state(
  p_user_id uuid,
  p_media_id uuid,
  p_expected_upload_attempt integer,
  p_status text,
  p_width integer,
  p_height integer,
  p_duration_sec numeric
)
returns public.outfit_media
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.outfit_media;
begin
  perform public.outfit_lock_user(p_user_id);

  select * into v_row
    from public.outfit_media
   where id = p_media_id and user_id = p_user_id
     for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'media_not_found';
  end if;

  if v_row.upload_attempt is distinct from p_expected_upload_attempt then
    raise exception using errcode = 'P0001', message = 'media_attempt_changed';
  end if;

  if not (
    (v_row.status = 'uploading'  and p_status in ('processing', 'ready', 'failed'))
    or (v_row.status = 'processing' and p_status in ('processing', 'ready', 'failed'))
    or (v_row.status = 'ready'      and p_status = 'ready')
  ) then
    raise exception using errcode = 'P0001', message = 'invalid_media_transition';
  end if;

  update public.outfit_media
     set status       = p_status,
         width        = coalesce(p_width, width),
         height       = coalesce(p_height, height),
         duration_sec = coalesce(p_duration_sec, duration_sec),
         updated_at   = now()
   where id = p_media_id
  returning * into v_row;
  return v_row;
end;
$$;

-- -----------------------------------------
-- apply_stream_webhook
-- p_status は mapStreamState で直した値（processing / ready / failed）。戻り値は applied / duplicate / ignored
-- -----------------------------------------
create or replace function public.apply_stream_webhook(
  p_asset_id text,
  p_status text,
  p_width integer,
  p_height integer,
  p_duration_sec numeric
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
  v_row  public.outfit_media;
begin
  if p_status is null or p_status not in ('processing', 'ready', 'failed') then
    raise exception using errcode = 'P0001', message = 'invalid_media_status';
  end if;

  -- 古い試行の通知は、今の provider_asset_id と合わないのでここで ignored になる
  select user_id into v_user
    from public.outfit_media
   where provider = 'cf_stream' and provider_asset_id = p_asset_id;
  if not found then
    return 'ignored';
  end if;

  perform public.outfit_lock_user(v_user);

  -- ロックを取ったあとで読み直す（待っている間に置き換わっていないか）
  select * into v_row
    from public.outfit_media
   where provider = 'cf_stream' and provider_asset_id = p_asset_id
     for update;
  if not found then
    return 'ignored';
  end if;

  if v_row.status = p_status then
    return 'duplicate';
  end if;
  -- 終わった状態は、遅れて届いた通知で戻さない
  if v_row.status in ('ready', 'failed') then
    return 'ignored';
  end if;

  update public.outfit_media
     set status       = p_status,
         width        = coalesce(p_width, width),
         height       = coalesce(p_height, height),
         duration_sec = coalesce(p_duration_sec, duration_sec),
         updated_at   = now()
   where id = v_row.id;
  return 'applied';
end;
$$;

-- -----------------------------------------
-- claim_media_deletions
-- 取り出した行に claim_token と5分のリースを書いて返す。取り合いは skip locked で避ける
-- -----------------------------------------
create or replace function public.claim_media_deletions(p_limit integer)
returns setof public.media_deletion_queue
language sql
security definer
set search_path = ''
as $$
  update public.media_deletion_queue q
     set claim_token = gen_random_uuid(),
         lease_until = now() + interval '5 minutes',
         updated_at  = now()
   where q.id in (
     select d.id
       from public.media_deletion_queue d
      where d.done_at is null
        and d.next_attempt_at <= now()
        and d.attempts < 10
        and (d.lease_until is null or d.lease_until < now())
      order by d.next_attempt_at, d.id
      limit greatest(p_limit, 0)
        for update skip locked
   )
  returning q.*;
$$;

-- -----------------------------------------
-- finish_media_deletion
-- 照合と更新を1文で行う。失敗の次の試行まで: 1回目1分、2回目10分、3回目1時間、4回目以降1日
-- -----------------------------------------
create or replace function public.finish_media_deletion(
  p_id uuid,
  p_claim_token uuid,
  p_ok boolean,
  p_error text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  update public.media_deletion_queue
     set claim_token     = null,
         lease_until     = null,
         done_at         = case when p_ok then now() else done_at end,
         attempts        = case when p_ok then attempts else attempts + 1 end,
         last_error      = case when p_ok then last_error else p_error end,
         next_attempt_at = case
           when p_ok then next_attempt_at
           when attempts + 1 = 1 then now() + interval '1 minute'
           when attempts + 1 = 2 then now() + interval '10 minutes'
           when attempts + 1 = 3 then now() + interval '1 hour'
           else now() + interval '1 day'
         end,
         updated_at      = now()
   where id = p_id and claim_token = p_claim_token
  returning id into v_id;
  return v_id is not null;
end;
$$;

-- -----------------------------------------
-- 権限: 先に全員から取り上げてから、service_role にだけ与える
-- -----------------------------------------
revoke all on function public.register_outfit_media(uuid, uuid, uuid, text, text, text, timestamptz, timestamptz, integer)
  from public, anon, authenticated, service_role;
revoke all on function public.replace_outfit_media_asset(uuid, uuid, integer, text, timestamptz)
  from public, anon, authenticated, service_role;
revoke all on function public.set_outfit_media_state(uuid, uuid, integer, text, integer, integer, numeric)
  from public, anon, authenticated, service_role;
revoke all on function public.apply_stream_webhook(text, text, integer, integer, numeric)
  from public, anon, authenticated, service_role;
revoke all on function public.claim_media_deletions(integer)
  from public, anon, authenticated, service_role;
revoke all on function public.finish_media_deletion(uuid, uuid, boolean, text)
  from public, anon, authenticated, service_role;

grant execute on function public.register_outfit_media(uuid, uuid, uuid, text, text, text, timestamptz, timestamptz, integer) to service_role;
grant execute on function public.replace_outfit_media_asset(uuid, uuid, integer, text, timestamptz) to service_role;
grant execute on function public.set_outfit_media_state(uuid, uuid, integer, text, integer, integer, numeric) to service_role;
grant execute on function public.apply_stream_webhook(text, text, integer, integer, numeric) to service_role;
grant execute on function public.claim_media_deletions(integer) to service_role;
grant execute on function public.finish_media_deletion(uuid, uuid, boolean, text) to service_role;

commit;
