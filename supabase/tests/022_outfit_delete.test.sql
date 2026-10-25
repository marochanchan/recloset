-- =========================================
-- migration 022（コーデの削除・今日着た・服の完全な削除の RPC）のテスト
-- （ローカルのDockerのPostgres専用。本番では実行しない）
--
-- A として RPC を呼び、postgres で結果の行を確かめる。
-- 全体を begin〜rollback で包む（ユーザー C のデータには触らない）。
-- 日付は過去の固定日。record_wear_today だけは「今日」（now()）を使う
-- =========================================
\set ON_ERROR_STOP on
\set A 'aaaaaaaa-0000-4000-8000-00000000000a'
\set B 'bbbbbbbb-0000-4000-8000-00000000000b'
\set T 'a1a1a1a1-0000-4000-8000-0000000000a1'
\set D 'a2a2a2a2-0000-4000-8000-0000000000a2'
\set G 'a3a3a3a3-0000-4000-8000-0000000000a3'
\set S 'a5a5a5a5-0000-4000-8000-0000000000a5'
\set X 'a6a6a6a6-0000-4000-8000-0000000000a6'
\set B_ITEM 'b1b1b1b1-0000-4000-8000-0000000000b1'
\set O1 'd0000001-0000-4000-8000-000000000001'
\set O2 'd0000002-0000-4000-8000-000000000002'
\set O3 'd0000003-0000-4000-8000-000000000003'
\set O_B 'b0000001-0000-4000-8000-000000000001'
\set U_G 'c0000001-0000-4000-8000-000000000001'
\set U_D 'c0000002-0000-4000-8000-000000000002'

begin;

-- -----------------------------------------
-- 補助関数（このトランザクションの中だけ。rollback で消える）
-- -----------------------------------------
create function test.as_user(p_uid uuid) returns void language plpgsql as $$
begin
  reset role;
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', p_uid::text, true);
  if current_user <> 'authenticated' or auth.uid() is distinct from p_uid then
    raise exception 'FAIL: as_user mismatch (% / %)', current_user, auth.uid();
  end if;
end;
$$;

create function test.as_postgres() returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claim.sub', '', true);
  if current_user <> 'postgres' then
    raise exception 'FAIL: as_postgres mismatch (%)', current_user;
  end if;
end;
$$;

-- A の書き込み対象の全体のハッシュ（「何も変わらない」を確かめる）
create function test.snap(p_user uuid) returns text language sql security definer as $$
  select md5(
    coalesce((select string_agg(o.id::text || o.status || o.revision || o.worn_on, ',' order by o.id)
                from public.outfits o where o.user_id = p_user), '') ||
    coalesce((select string_agg(oi.outfit_id::text || oi.item_id || coalesce(oi.wear_log_id::text, ''), ',' order by oi.outfit_id, oi.item_id)
                from public.outfit_items oi where oi.user_id = p_user), '') ||
    coalesce((select string_agg(wl.id::text || wl.worn_at || wl.source, ',' order by wl.id)
                from public.wear_logs wl join public.clothing_items ci on ci.id = wl.clothing_item_id
               where ci.user_id = p_user), '') ||
    coalesce((select string_agg(ci.id::text || ci.wear_count || coalesce(ci.last_worn_at::text, ''), ',' order by ci.id)
                from public.clothing_items ci where ci.user_id = p_user), '') ||
    (select count(*)::text from public.media_deletion_queue));
$$;

-- 019 の行動履歴（wear_logs の insert で wear_logged が1件）の増え方
create table test.ev_marks (label text primary key, n bigint);
create function test.ev_count(p_user uuid) returns bigint language sql security definer as $$
  select count(*) from public.closet_activity_events
   where user_id = p_user and action = 'wear_logged' and source_table = 'wear_logs';
$$;
create function test.ev_mark(p_label text, p_user uuid) returns void language sql security definer as $$
  insert into test.ev_marks values (p_label, test.ev_count(p_user));
$$;
create function test.ev_delta(p_label text, p_user uuid) returns bigint language sql security definer as $$
  select test.ev_count(p_user) - n from test.ev_marks where label = p_label;
$$;

grant usage on schema test to authenticated;
grant execute on all functions in schema test to anon, authenticated, service_role;

-- -----------------------------------------
-- 準備（postgres）
-- -----------------------------------------
delete from public.wear_logs
 where clothing_item_id in (select id from public.clothing_items where user_id = :'A');

insert into public.clothing_items (id, user_id, title, category, wear_count)
values (:'S', :'A', 'スカート', 'bottoms', 0),
       (:'X', :'A', 'しまった服', 'tops', 0);
update public.clothing_items set archived_at = now() where id = :'X';

-- 未使用の wear_today: G は O1 の日（10/31）、D は 2025-09（別の月）
insert into public.wear_logs (id, clothing_item_id, worn_at, source)
values (:'U_G', :'G', '2025-10-31 09:00+09', 'wear_today'),
       (:'U_D', :'D', '2025-09-15 09:00+09', 'wear_today');
select public.recompute_item_wear(array(select id from public.clothing_items where user_id = :'A'));
select public.rebuild_monthly_stats(:'A', '2025-09-01');

insert into public.outfits (id, user_id, worn_on, source)
values (:'O1', :'A', '2025-10-31', 'upload'),
       (:'O2', :'A', '2025-11-03', 'upload'),
       (:'O3', :'A', '2025-11-04', 'upload'),
       (:'O_B', :'B', '2025-10-31', 'upload');
insert into public.outfit_media (user_id, outfit_id, kind, provider, provider_asset_id)
values (:'A', :'O1', 'photo', 'cf_images', 'img-o1'),
       (:'A', :'O1', 'video', 'cf_stream', 'vid-o1');

select test.as_user(:'A');
select test.assert(current_user = 'authenticated' and auth.uid() = :'A'::uuid, 'A として実行している');
select public.confirm_outfit(:'O1', 0, '2025-10-31', array[:'T', :'D', :'G']::uuid[], null);
select public.confirm_outfit(:'O2', 0, '2025-11-03', array[:'T', :'D', :'G']::uuid[], null);
select public.confirm_outfit(:'O3', 0, '2025-11-04', array[:'T', :'G']::uuid[], null);

select test.as_postgres();
select test.assert(
  exists (select 1 from public.outfit_combo_monthly_stats
           where user_id = :'A' and month = '2025-10-01' and item_ids = array[:'T', :'D', :'G']::uuid[])
  and (select count(*) from public.wear_logs where clothing_item_id in (:'T', :'D', :'G') and source = 'outfit') = 7,
  '（確認）準備: 2025-10 に {T,D,G} の組み合わせがあり、source=outfit の記録は7件（G の 10/31 は wear_today を使う）');

-- -----------------------------------------
-- B のコーデを A が消そうとする: outfit_not_found で何も変わらない
-- -----------------------------------------
create temp table _snap (label text, h text);
grant all on _snap to authenticated;
insert into _snap values ('before_b', test.snap(:'A'));

select test.as_user(:'A');
select test.expect_error(
  format('select public.delete_outfit(%L)', :'O_B'), 'outfit_not_found', 'B のコーデは outfit_not_found');
select test.expect_error(
  format('select public.delete_outfit(%L)', gen_random_uuid()), 'outfit_not_found', '存在しないコーデは outfit_not_found');
select test.as_postgres();
select test.assert(
  exists (select 1 from public.outfits where id = :'O_B') and test.snap(:'A') = (select h from _snap where label = 'before_b'),
  'B のコーデを A が delete_outfit すると outfit_not_found で、何も消えない');

-- -----------------------------------------
-- delete_outfit(O1)
-- -----------------------------------------
select test.as_user(:'A');
select public.delete_outfit(:'O1');
select test.as_postgres();
select test.assert(
  not exists (select 1 from public.outfits where id = :'O1')
  and not exists (select 1 from public.outfit_items where outfit_id = :'O1')
  and not exists (select 1 from public.outfit_media where outfit_id = :'O1')
  -- source=outfit の記録（T・D の 10/31）は消える
  and not exists (select 1 from public.wear_logs
                   where clothing_item_id in (:'T', :'D') and (worn_at at time zone 'Asia/Tokyo')::date = '2025-10-31')
  -- wear_today の記録（G の U_G）は残る
  and exists (select 1 from public.wear_logs where id = :'U_G' and source = 'wear_today')
  and (select count(*) from public.media_deletion_queue
        where user_id = :'A' and (provider, provider_asset_id) in (('cf_images', 'img-o1'), ('cf_stream', 'vid-o1'))) = 2
  and (select wear_count from public.clothing_items where id = :'T') = 2
  and (select wear_count from public.clothing_items where id = :'G') = 3
  and (select last_worn_at from public.clothing_items where id = :'T') = '2025-11-04 12:00+09'::timestamptz,
  'delete_outfit で source=outfit の記録は消え、wear_today の記録は残る。メディアの asset が削除待ちに入る（wear_count も計算し直される）');

select test.assert(
  not exists (select 1 from public.outfit_combo_monthly_stats where user_id = :'A' and month = '2025-10-01')
  and not exists (select 1 from public.item_pair_monthly_stats where user_id = :'A' and month = '2025-10-01')
  and (select outfit_count from public.item_monthly_stats where user_id = :'A' and item_id = :'G' and month = '2025-10-01') = 0
  and (select wear_log_count from public.item_monthly_stats where user_id = :'A' and item_id = :'G' and month = '2025-10-01') = 1
  and not exists (select 1 from public.item_monthly_stats where user_id = :'A' and item_id = :'T' and month = '2025-10-01'),
  'delete_outfit のあと、そのコーデの月のサマリーから、そのコーデの分が消える（G の wear_today の分だけ残る）');

-- 同じメディアが別の経路で入っていても二重にならない（on conflict do nothing）
select test.assert(
  (select count(*) from public.media_deletion_queue where provider_asset_id in ('img-o1', 'vid-o1')) = 2,
  '（確認）削除待ちは asset ごとに1行');

-- -----------------------------------------
-- record_wear_today
-- -----------------------------------------
select test.ev_mark('w1', :'A');
select test.as_user(:'A');
create temp table _r (label text, res jsonb);
grant all on _r to authenticated;
insert into _r select 'w1', public.record_wear_today(:'S');
select test.as_postgres();
select test.assert(
  (select res = '{"created": true}'::jsonb from _r where label = 'w1')
  and (select count(*) from public.wear_logs where clothing_item_id = :'S') = 1
  and (select source from public.wear_logs where clothing_item_id = :'S') = 'wear_today'
  and (select worn_at from public.wear_logs where clothing_item_id = :'S') = now()
  and (select wear_count from public.clothing_items where id = :'S') = 1
  and (select last_worn_at from public.clothing_items where id = :'S') = now()
  and (select wear_log_count from public.item_monthly_stats
        where user_id = :'A' and item_id = :'S'
          and month = date_trunc('month', (now() at time zone 'Asia/Tokyo'))::date) = 1
  and test.ev_delta('w1', :'A') = 1,
  'record_wear_today は今日の記録を now() で1件作り、wear_count・今月のサマリーを更新する（行動履歴は +1）');

select test.ev_mark('w2', :'A');
select test.as_user(:'A');
insert into _r select 'w2', public.record_wear_today(:'S');
select test.as_postgres();
select test.assert(
  (select res = '{"created": false}'::jsonb from _r where label = 'w2')
  and (select count(*) from public.wear_logs where clothing_item_id = :'S') = 1
  and (select wear_count from public.clothing_items where id = :'S') = 1
  and test.ev_delta('w2', :'A') = 0,
  'record_wear_today は1日1回だけ作り、2回目は {created:false}（行動履歴は +0）');

insert into _snap values ('before_wt', test.snap(:'A'));
select test.as_user(:'A');
select test.expect_error(format('select public.record_wear_today(%L)', :'X'),
  'item_not_found', 'しまった服は item_not_found');
select test.expect_error(format('select public.record_wear_today(%L)', :'B_ITEM'),
  'item_not_found', 'B の服は item_not_found');
select test.as_postgres();
select test.assert(test.snap(:'A') = (select h from _snap where label = 'before_wt'),
  'record_wear_today はしまった服・B の服なら item_not_found で、何も変わらない');

-- -----------------------------------------
-- hard_delete_item(D)
--   D は O2（11/03）に入っている。O3 は {T,G}。U_D は 2025-09 の wear_today
-- -----------------------------------------
select test.assert(
  (select count(*) from public.item_pair_monthly_stats where user_id = :'A' and month = '2025-11-01') = 3
  and exists (select 1 from public.item_monthly_stats where user_id = :'A' and item_id = :'D' and month = '2025-09-01'),
  '（確認）D を消す前: 2025-11 の組は3つ、D は 2025-09 にも行がある');

select test.as_user(:'A');
select test.expect_error(format('select public.hard_delete_item(%L)', :'B_ITEM'),
  'item_not_found', 'B の服の hard_delete_item は item_not_found');
select public.hard_delete_item(:'D');
select test.as_postgres();
select test.assert(
  not exists (select 1 from public.clothing_items where id = :'D')
  and not exists (select 1 from public.wear_logs where clothing_item_id = :'D')
  and not exists (select 1 from public.outfit_items where item_id = :'D')
  and exists (select 1 from public.outfits where id = :'O2' and status = 'confirmed')
  and exists (select 1 from public.outfits where id = :'O3' and status = 'confirmed')
  and (select array_agg(item_id order by item_id) from public.outfit_items where outfit_id = :'O2')
      = array[:'T', :'G']::uuid[]
  -- 消した服の行は 2025-09・2025-11 のサマリーから消える
  and not exists (select 1 from public.item_monthly_stats where item_id = :'D')
  -- ほかの服の組み合わせ（T と G）は残り、O2・O3 の2回分になる
  and (select count(*) from public.item_pair_monthly_stats where user_id = :'A' and month = '2025-11-01') = 1
  and (select outfit_count from public.item_pair_monthly_stats
        where user_id = :'A' and month = '2025-11-01' and item_a = least(:'T'::uuid, :'G'::uuid)
          and item_b = greatest(:'T'::uuid, :'G'::uuid)) = 2
  and (select outfit_count from public.outfit_combo_monthly_stats
        where user_id = :'A' and month = '2025-11-01' and item_ids = array[:'T', :'G']::uuid[]) = 2
  and (select count(*) from public.outfit_combo_monthly_stats where user_id = :'A' and month = '2025-11-01') = 1,
  'hard_delete_item でコーデは残り、ほかの服の組み合わせのサマリーは残る。消した服の行はサマリーから消える');

-- -----------------------------------------
-- 権限
-- -----------------------------------------
select test.as_user(:'A');
select test.expect_denied(format('select public.enqueue_media_deletion(%L, %L, %L)', :'A', 'cf_images', 'x1'),
  'authenticated は enqueue_media_deletion を呼べない');
select test.as_postgres();
set local role anon;
select test.assert(current_user = 'anon' and auth.uid() is null, '（確認）anon として実行している');
select test.expect_denied(format('select public.enqueue_media_deletion(%L, %L, %L)', :'A', 'cf_images', 'x2'),
  'anon は enqueue_media_deletion を呼べない');
select test.expect_denied(format('select public.delete_outfit(%L)', :'O2'), 'anon は delete_outfit を呼べない');
select test.expect_denied(format('select public.record_wear_today(%L)', :'S'), 'anon は record_wear_today を呼べない');
select test.expect_denied(format('select public.hard_delete_item(%L)', :'S'), 'anon は hard_delete_item を呼べない');
select test.as_postgres();
set local role service_role;
select test.assert(current_user = 'service_role', '（確認）service_role として実行している');
select test.expect_denied(format('select public.enqueue_media_deletion(%L, %L, %L)', :'A', 'cf_images', 'x3'),
  'service_role は enqueue_media_deletion を呼べない');
select test.as_postgres();
select test.assert(
  not exists (select 1 from public.media_deletion_queue where provider_asset_id in ('x1', 'x2', 'x3'))
  and not has_function_privilege('authenticated', 'public.enqueue_media_deletion(uuid,text,text)', 'execute')
  and not has_function_privilege('anon', 'public.enqueue_media_deletion(uuid,text,text)', 'execute')
  and not has_function_privilege('service_role', 'public.enqueue_media_deletion(uuid,text,text)', 'execute')
  and has_function_privilege('authenticated', 'public.delete_outfit(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.record_wear_today(uuid)', 'execute')
  and has_function_privilege('authenticated', 'public.hard_delete_item(uuid)', 'execute')
  and not has_function_privilege('anon', 'public.delete_outfit(uuid)', 'execute')
  and not has_function_privilege('service_role', 'public.hard_delete_item(uuid)', 'execute'),
  'authenticated・anon・service_role から enqueue_media_deletion を呼ぶと insufficient_privilege（キューにも入らない）。3つの RPC は authenticated にだけ許可');

rollback;
