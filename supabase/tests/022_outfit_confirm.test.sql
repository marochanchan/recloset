-- =========================================
-- migration 022（コーデの下書き・確定・編集の RPC）のテスト
-- （ローカルのDockerのPostgres専用。本番では実行しない）
--
-- A として RPC を呼び、postgres で結果の行を確かめる。
-- 全体を begin〜rollback で包む（ユーザー C のデータには触らない）。
-- 日付は過去の固定日（2025-10-31 など）。「今日」の worn_at = now() の分岐を踏まないため
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
\set REQ1 '11111111-0000-4000-8000-000000000001'
\set O_B 'b0000001-0000-4000-8000-000000000001'
\set U1 'c0000001-0000-4000-8000-000000000001'
\set U_S 'c0000002-0000-4000-8000-000000000002'
\set U_T 'c0000003-0000-4000-8000-000000000003'

begin;

-- -----------------------------------------
-- 補助関数（このトランザクションの中だけ。rollback で消える）
-- -----------------------------------------
-- 呼び出しの回数を数える（「いつも成り立つこと」を何回確かめたか）
create table test.inv_calls (outfit_id uuid, label text);

-- 実行ユーザーを切り替え、current_user と auth.uid() が意図どおりか確かめる
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

-- 確定のあと、いつも成り立つこと（postgres 権限で読む）
--  1. outfit_items の服の集合が、新しい服と完全に一致する
--  2. どの行にも wear_log_id があり、その記録はその服のもので、日本時間の日付が worn_on と同じ
--  おまけ: 本人の服の wear_count / last_worn_at が、残っている記録から計算した値と同じ
create function test.check_invariants(p_outfit uuid, p_items uuid[], p_worn_on date, p_label text)
returns void language plpgsql security definer as $$
declare
  v_actual uuid[];
  v_expected uuid[];
  v_bad int;
  v_user uuid;
begin
  select array_agg(distinct x order by x) into v_expected from unnest(p_items) x;
  select coalesce(array_agg(item_id order by item_id), '{}') into v_actual
    from public.outfit_items where outfit_id = p_outfit;
  if v_actual is distinct from coalesce(v_expected, '{}') then
    raise exception 'FAIL: invariant 1 (%): items % <> %', p_label, v_actual, v_expected;
  end if;

  select count(*) into v_bad
    from public.outfit_items oi
    left join public.wear_logs wl on wl.id = oi.wear_log_id
   where oi.outfit_id = p_outfit
     and (wl.id is null
          or wl.clothing_item_id <> oi.item_id
          or (wl.worn_at at time zone 'Asia/Tokyo')::date <> p_worn_on);
  if v_bad <> 0 then
    raise exception 'FAIL: invariant 2 (%): % rows with missing/wrong wear log', p_label, v_bad;
  end if;

  select user_id into v_user from public.outfits where id = p_outfit;
  select count(*) into v_bad
    from public.clothing_items ci
   where ci.user_id = v_user
     and (ci.wear_count <> (select count(*) from public.wear_logs wl where wl.clothing_item_id = ci.id)
          or ci.last_worn_at is distinct from
             (select max(wl.worn_at) from public.wear_logs wl where wl.clothing_item_id = ci.id));
  if v_bad <> 0 then
    raise exception 'FAIL: wear_count/last_worn_at mismatch (%): % items', p_label, v_bad;
  end if;

  insert into test.inv_calls values (p_outfit, p_label);
end;
$$;

-- confirm_outfit を呼び、確定・変更なしのときは毎回「いつも成り立つこと」を確かめる
create function test.confirm(p_outfit uuid, p_rev int, p_worn_on date, p_items uuid[], p_note text, p_label text)
returns jsonb language plpgsql as $$
declare
  v_res jsonb;
  v_user text := current_user;
  v_uid uuid := auth.uid();
begin
  v_res := public.confirm_outfit(p_outfit, p_rev, p_worn_on, p_items, p_note);
  if v_res->>'status' in ('confirmed', 'unchanged') then
    perform test.check_invariants(p_outfit, p_items, p_worn_on, p_label);
  end if;
  return v_res;
end;
$$;

-- A の書き込み対象の全体のハッシュ（「何も変わらない」を確かめる）
create function test.snap(p_user uuid) returns text language sql security definer as $$
  select md5(
    coalesce((select string_agg(o.id::text || o.status || o.revision || o.worn_on || coalesce(o.note, ''), ',' order by o.id)
                from public.outfits o where o.user_id = p_user), '') ||
    coalesce((select string_agg(oi.outfit_id::text || oi.item_id || coalesce(oi.wear_log_id::text, ''), ',' order by oi.outfit_id, oi.item_id)
                from public.outfit_items oi where oi.user_id = p_user), '') ||
    coalesce((select string_agg(wl.id::text || wl.worn_at || wl.source, ',' order by wl.id)
                from public.wear_logs wl join public.clothing_items ci on ci.id = wl.clothing_item_id
               where ci.user_id = p_user), '') ||
    coalesce((select string_agg(ci.id::text || ci.wear_count || coalesce(ci.last_worn_at::text, ''), ',' order by ci.id)
                from public.clothing_items ci where ci.user_id = p_user), ''));
$$;

grant usage on schema test to authenticated;
grant execute on all functions in schema test to anon, authenticated, service_role;
grant insert on test.inv_calls to authenticated;

-- -----------------------------------------
-- 準備（postgres）
-- A の既存の着用記録は消して、このテストの事実だけにする
-- -----------------------------------------
delete from public.wear_logs
 where clothing_item_id in (select id from public.clothing_items where user_id = :'A');

insert into public.clothing_items (id, user_id, title, category, wear_count)
values
  (:'S', :'A', 'スカート', 'bottoms', 0),
  (:'X', :'A', 'しまった服', 'tops', 0);
update public.clothing_items set archived_at = now() where id = :'X';

-- 未使用の wear_today の記録
--   G: 2025-10-31 09:00 JST（初回の確定で使われる）
--   S: 2025-11-02 09:00 JST（日付を 11/2 に変えたときのつなぎ替え先）
--   T: 2025-09-15 12:00 JST（last_worn_at が戻る先）
insert into public.wear_logs (id, clothing_item_id, worn_at, source)
values
  (:'U1',  :'G', '2025-10-31 09:00+09', 'wear_today'),
  (:'U_S', :'S', '2025-11-02 09:00+09', 'wear_today'),
  (:'U_T', :'T', '2025-09-15 12:00+09', 'wear_today');
select public.recompute_item_wear(array(select id from public.clothing_items where user_id = :'A'));

-- B の確認待ちのコーデ
insert into public.outfits (id, user_id, worn_on, source) values (:'O_B', :'B', '2025-10-31', 'manual');

-- -----------------------------------------
-- 下書き
-- -----------------------------------------
select test.as_user(:'A');
select test.assert(current_user = 'authenticated' and auth.uid() = :'A'::uuid, 'A として実行している');

create temp table _o (id uuid);
grant all on _o to authenticated;
insert into _o select (public.create_outfit_draft(:'REQ1', '2025-10-31', 'upload')).id;

select test.as_postgres();
select test.assert(
  (select count(*) from public.outfits where user_id = :'A' and client_request_id = :'REQ1') = 1
  and (select status from public.outfits where id = (select id from _o)) = 'pending'
  and (select revision from public.outfits where id = (select id from _o)) = 0,
  '下書きは pending・revision 0 で作られる');

select test.as_user(:'A');
select test.assert(
  (select (public.create_outfit_draft(:'REQ1', '2025-10-31', 'upload')).id) = (select id from _o),
  '同じ client_request_id の create_outfit_draft は同じ id を返し、行は1件'
  );
select test.as_postgres();
select test.assert(
  (select count(*) from public.outfits where user_id = :'A' and client_request_id = :'REQ1') = 1,
  '再送しても outfits の行は1件のまま');

select test.as_user(:'A');
select test.expect_error(
  format('select public.create_outfit_draft(%L, %L, %L)', gen_random_uuid(), '2025-10-31', 'bogus'),
  'outfits_source_check', 'p_source が CHECK を外れると拒否される');

-- -----------------------------------------
-- 確定: 初めて {T, D, G}
-- -----------------------------------------
select test.as_user(:'A');
create temp table _r (label text, res jsonb);
grant all on _r to authenticated;

insert into _r select 'first',
  test.confirm((select id from _o), 0, '2025-10-31', array[:'T', :'D', :'G']::uuid[], null, 'first');

select test.as_postgres();
select test.assert(
  (select res->>'status' from _r where label = 'first') = 'confirmed'
  and (select (res->>'revision')::int from _r where label = 'first') = 1
  and (select status from public.outfits where id = (select id from _o)) = 'confirmed'
  and (select confirmed_at is not null from public.outfits where id = (select id from _o))
  and (select count(*) from public.wear_logs where clothing_item_id in (:'T', :'D') and source = 'outfit') = 2
  and (select count(distinct clothing_item_id) from public.wear_logs where clothing_item_id in (:'T', :'D') and source = 'outfit') = 2
  and not exists (select 1 from public.wear_logs
                   where source = 'outfit' and worn_at <> '2025-10-31 12:00+09'),
  '初めての確定は {confirmed, 1}、服ごとに source=outfit の記録が1件、worn_at は 12:00 JST');

select test.assert(
  (select wear_log_id from public.outfit_items where outfit_id = (select id from _o) and item_id = :'G') = :'U1'::uuid
  and (select count(*) from public.wear_logs where clothing_item_id = :'G') = 1
  and (select source from public.wear_logs where id = :'U1') = 'wear_today',
  '同じ日の未使用の wear_today の記録があれば、それを使う（記録が増えない）');


create temp table _snap (label text, h text);
grant all on _snap to authenticated;
select test.as_postgres();
insert into _snap values ('s1', test.snap(:'A'));

select test.as_user(:'A');
insert into _r select 'again0',
  test.confirm((select id from _o), 0, '2025-10-31', array[:'D', :'G', :'T', :'T']::uuid[], null, 'again0');
insert into _r select 'again1',
  test.confirm((select id from _o), 1, '2025-10-31', array[:'T', :'D', :'G']::uuid[], null, 'again1');
select test.as_postgres();
select test.assert(
  (select res = '{"status": "unchanged", "revision": 1}'::jsonb from _r where label = 'again0')
  and (select res = '{"status": "unchanged", "revision": 1}'::jsonb from _r where label = 'again1')
  and test.snap(:'A') = (select h from _snap where label = 's1'),
  '同じ内容をもう一度（expected 0 でも 1 でも）送ると {unchanged, 1}、記録は増えない');

-- 月のサマリー（2025-10）: T と D と G の組み合わせが入っている
select test.assert(
  exists (select 1 from public.outfit_combo_monthly_stats
           where user_id = :'A' and month = '2025-10-01'
             and item_ids = array[:'T', :'D', :'G']::uuid[])
  and (select count(*) from public.item_pair_monthly_stats where user_id = :'A' and month = '2025-10-01') = 3,
  '（確認）確定すると 2025-10 の組み合わせと組が入る');

-- note だけを変える（expected 1）→ revision 2
select test.as_user(:'A');
insert into _r select 'note',
  test.confirm((select id from _o), 1, '2025-10-31', array[:'T', :'D', :'G']::uuid[], 'メモ', 'note');
select test.as_postgres();
select test.assert(
  (select res = '{"status": "confirmed", "revision": 2}'::jsonb from _r where label = 'note')
  and (select note from public.outfits where id = (select id from _o)) = 'メモ',
  '（確認）note だけの変更は {confirmed, 2}');
insert into _snap values ('s2', test.snap(:'A'));

-- 古い版から別の内容
select test.as_user(:'A');
insert into _r select 'stale',
  test.confirm((select id from _o), 1, '2025-10-31', array[:'T', :'D', :'S']::uuid[], 'メモ', 'stale');
select test.as_postgres();
select test.assert(
  (select res = '{"status": "stale", "revision": 2}'::jsonb from _r where label = 'stale')
  and test.snap(:'A') = (select h from _snap where label = 's2'),
  '古い版から別の内容を送ると {stale, 2}、何も変わらない');

-- 不正な expected
select test.as_user(:'A');
select test.expect_error(
  format('select public.confirm_outfit(%L, null, %L, %L, null)', (select id from _o), '2025-10-31', array[:'T']::uuid[]),
  'invalid_revision', 'expected null は invalid_revision');
select test.expect_error(
  format('select public.confirm_outfit(%L, -1, %L, %L, null)', (select id from _o), '2025-10-31', array[:'T']::uuid[]),
  'invalid_revision', 'expected -1 は invalid_revision');
select test.expect_error(
  format('select public.confirm_outfit(%L, 3, %L, %L, null)', (select id from _o), '2025-10-31', array[:'T']::uuid[]),
  'invalid_revision', 'expected 3（今より大きい）は invalid_revision');
select test.as_postgres();
select test.assert(test.snap(:'A') = (select h from _snap where label = 's2'),
  'expected が null・-1・今より大きい版なら invalid_revision で、何も変わらない');

select test.as_user(:'A');
select test.expect_error(
  format('select public.confirm_outfit(%L, 999, %L, %L, %L)', (select id from _o), '2025-10-31',
         array[:'T', :'D', :'G']::uuid[], 'メモ'),
  'invalid_revision', '中身が同じでも expected 999 は invalid_revision');
select test.as_postgres();
select test.assert(test.snap(:'A') = (select h from _snap where label = 's2'),
  '中身が今と同じでも、expected が 999 なら unchanged ではなく invalid_revision');

-- 外す: G を外す（wear_today の U1 は残る）
select test.as_user(:'A');
insert into _r select 'drop_g',
  test.confirm((select id from _o), 2, '2025-10-31', array[:'T', :'D']::uuid[], 'メモ', 'drop_g');
select test.as_postgres();
select test.assert(
  (select res = '{"status": "confirmed", "revision": 3}'::jsonb from _r where label = 'drop_g')
  and not exists (select 1 from public.outfit_items where outfit_id = (select id from _o) and item_id = :'G')
  and exists (select 1 from public.wear_logs where id = :'U1' and source = 'wear_today'),
  '（確認）G を外すと outfit_items の行が消え、使っていた wear_today の記録は残る');

select test.assert(
  not exists (select 1 from public.item_pair_monthly_stats
               where user_id = :'A' and month = '2025-10-01' and (item_a = :'G' or item_b = :'G'))
  and not exists (select 1 from public.outfit_combo_monthly_stats
                   where user_id = :'A' and month = '2025-10-01' and item_ids = array[:'T', :'D', :'G']::uuid[])
  and exists (select 1 from public.outfit_combo_monthly_stats
               where user_id = :'A' and month = '2025-10-01' and item_ids = array[:'T', :'D']::uuid[]),
  '服を外したあと、外した服を含む組み合わせ（item_pair_monthly_stats）と、元の服の集合の combo の行が消える');

-- 足す S、外す D（D は source=outfit の記録を消す）
select test.as_user(:'A');
insert into _r select 'swap',
  test.confirm((select id from _o), 3, '2025-10-31', array[:'T', :'S']::uuid[], 'メモ', 'swap');
select test.as_postgres();
select test.assert(
  (select res = '{"status": "confirmed", "revision": 4}'::jsonb from _r where label = 'swap')
  and not exists (select 1 from public.outfit_items where outfit_id = (select id from _o) and item_id = :'D')
  and (select count(*) from public.wear_logs where clothing_item_id = :'D') = 0,
  '服を外すと、その服の outfit_items の行が消える。source=outfit の記録は消え、使っていた wear_today の記録は残る');

select test.assert(
  exists (select 1 from public.outfit_items oi join public.wear_logs wl on wl.id = oi.wear_log_id
           where oi.outfit_id = (select id from _o) and oi.item_id = :'S'
             and wl.source = 'outfit' and wl.clothing_item_id = :'S')
  and (select wear_count from public.clothing_items where id = :'S') = 2,
  '服を足すと、outfit_items の行ができ、その服の記録がつながる');
-- （S の wear_count 2 = 未使用の wear_today U_S（11/2）+ 新しい source=outfit の記録）

-- 日付を 10/31 → 11/2 に変える（T は source=outfit の記録を直す、S は未使用の wear_today につなぎ替える）
select test.as_postgres();
insert into _snap values ('t_log', (select wear_log_id::text from public.outfit_items
                                     where outfit_id = (select id from _o) and item_id = :'T'));
insert into _snap values ('t_cnt', (select count(*)::text from public.wear_logs where clothing_item_id = :'T'));
insert into _snap values ('oct', (select count(*)::text from public.item_monthly_stats
                                   where user_id = :'A' and item_id = :'T' and month = '2025-10-01'));

select test.as_user(:'A');
insert into _r select 'move',
  test.confirm((select id from _o), 4, '2025-11-02', array[:'T', :'S']::uuid[], 'メモ', 'move');
select test.as_postgres();
select test.assert(
  (select res = '{"status": "confirmed", "revision": 5}'::jsonb from _r where label = 'move')
  and (select wear_log_id::text from public.outfit_items where outfit_id = (select id from _o) and item_id = :'T')
      = (select h from _snap where label = 't_log')
  and (select worn_at from public.wear_logs
        where id = (select h from _snap where label = 't_log')::uuid) = '2025-11-02 12:00+09'::timestamptz
  and (select count(*)::text from public.wear_logs where clothing_item_id = :'T')
      = (select h from _snap where label = 't_cnt')
  and (select h from _snap where label = 'oct') = '1'
  and not exists (select 1 from public.item_monthly_stats
                   where user_id = :'A' and item_id = :'T' and month = '2025-10-01' and wear_log_count > 0
                     and last_worn_on >= '2025-10-31')
  and (select wear_log_count from public.item_monthly_stats
        where user_id = :'A' and item_id = :'T' and month = '2025-11-01') = 1
  and (select outfit_count from public.item_monthly_stats
        where user_id = :'A' and item_id = :'T' and month = '2025-11-01') = 1,
  '日付を 10/31 → 11/2 に変えると、source=outfit の記録の worn_at が直り（記録の件数は同じ）、10月と11月の両方のサマリーが変わる');

select test.assert(
  (select wear_log_id from public.outfit_items where outfit_id = (select id from _o) and item_id = :'S') = :'U_S'::uuid
  and (select count(*) from public.wear_logs where clothing_item_id = :'S') = 1
  and (select source from public.wear_logs where id = :'U_S') = 'wear_today',
  '日付を変えた先の日に、残す服の未使用の wear_today があれば、それにつなぎ替え、source=outfit の記録は消える');

-- 最新の着用を過去へ（T: 11/2 → 2025-09-01。ほかの記録 U_T = 9/15 が最新に戻る）
select test.as_postgres();
select test.assert(
  (select last_worn_at from public.clothing_items where id = :'T') = '2025-11-02 12:00+09'::timestamptz,
  '（確認）直す前の T の last_worn_at は 11/2');
select test.as_user(:'A');
insert into _r select 'past',
  test.confirm((select id from _o), 5, '2025-09-01', array[:'T', :'S']::uuid[], 'メモ', 'past');
select test.as_postgres();
select test.assert(
  (select res = '{"status": "confirmed", "revision": 6}'::jsonb from _r where label = 'past')
  and (select last_worn_at from public.clothing_items where id = :'T') = '2025-09-15 12:00+09'::timestamptz
  and (select wear_count from public.clothing_items where id = :'T') = 2
  -- S: つながっていた wear_today (11/2) は残し、9/1 の source=outfit の記録を作ってつなぐ
  and (select source from public.wear_logs
        where id = (select wear_log_id from public.outfit_items
                     where outfit_id = (select id from _o) and item_id = :'S')) = 'outfit'
  and exists (select 1 from public.wear_logs where id = :'U_S' and source = 'wear_today'),
  '最新の着用を過去の日付に直すと、last_worn_at がほかの記録の最新に戻る');

-- -----------------------------------------
-- 失敗しても何も書き込まれない
-- -----------------------------------------
select test.as_postgres();
insert into _snap values ('s3', test.snap(:'A'));
select test.as_user(:'A');
select test.expect_error(
  format('select public.confirm_outfit(%L, 6, %L, %L, %L)', (select id from _o), '2025-09-01',
         array[:'T', :'B_ITEM']::uuid[], 'メモ'),
  'item_not_found', 'B の服を入れると item_not_found');
select test.as_postgres();
select test.assert(
  test.snap(:'A') = (select h from _snap where label = 's3')
  and (select revision from public.outfits where id = (select id from _o)) = 6
  and (select count(*) from public.wear_logs where clothing_item_id = :'B_ITEM') = 1,
  'B の服を入れると item_not_found で、何も書き込まれない（revision も記録も変わらない）');

select test.as_user(:'A');
select test.expect_error(
  format('select public.confirm_outfit(%L, 6, %L, %L, %L)', (select id from _o), '2025-09-01',
         array[:'T', gen_random_uuid()]::uuid[], 'メモ'),
  'item_not_found', '存在しない服の id を入れても item_not_found');
select test.as_postgres();
select test.assert(test.snap(:'A') = (select h from _snap where label = 's3'),
  '存在しない服の id を入れても item_not_found');

select test.as_user(:'A');
select test.expect_error(
  format('select public.confirm_outfit(%L, 6, %L, %L, %L)', (select id from _o), '2025-09-01',
         array[:'T', :'X']::uuid[], 'メモ'),
  'item_not_found', 'しまった服を足すと item_not_found');
select test.as_postgres();
select test.assert(test.snap(:'A') = (select h from _snap where label = 's3'),
  'しまった服を新しく足すと item_not_found');

select test.as_user(:'A');
select test.expect_error(
  format('select public.confirm_outfit(%L, 0, %L, %L, null)', :'O_B', '2025-10-31', array[:'T']::uuid[]),
  'outfit_not_found', 'B のコーデを A が確定しようとすると outfit_not_found');
select test.as_postgres();
select test.assert(
  (select revision from public.outfits where id = :'O_B') = 0
  and (select status from public.outfits where id = :'O_B') = 'pending',
  'B のコーデを A が確定しようとすると outfit_not_found');

-- ログイン前
select test.as_postgres();
set local role authenticated;
select test.assert(current_user = 'authenticated' and auth.uid() is null, '（確認）sub なしの authenticated');
select test.expect_error(
  format('select public.confirm_outfit(%L, 0, %L, %L, null)', (select id from _o), '2025-10-31', array[]::uuid[]),
  'not_authenticated', 'auth.uid() が null なら not_authenticated（confirm_outfit）');
select test.expect_error(
  format('select public.create_outfit_draft(%L, %L, %L)', gen_random_uuid(), '2025-10-31', 'upload'),
  'not_authenticated', 'auth.uid() が null なら not_authenticated（create_outfit_draft）');

-- -----------------------------------------
-- 権限
-- -----------------------------------------
select test.as_postgres();
set local role anon;
select test.assert(current_user = 'anon' and auth.uid() is null, '（確認）anon として実行している');
select test.expect_denied(
  format('select public.create_outfit_draft(%L, %L, %L)', gen_random_uuid(), '2025-10-31', 'upload'),
  'anon は create_outfit_draft を呼べない');
select test.expect_denied(
  format('select public.confirm_outfit(%L, 0, %L, %L, null)', gen_random_uuid(), '2025-10-31', array[]::uuid[]),
  'anon は confirm_outfit を呼べない');
select test.as_postgres();
select test.assert(
  not has_function_privilege('service_role', 'public.confirm_outfit(uuid,integer,date,uuid[],text)', 'execute')
  and not has_function_privilege('service_role', 'public.create_outfit_draft(uuid,date,text)', 'execute')
  and has_function_privilege('authenticated', 'public.confirm_outfit(uuid,integer,date,uuid[],text)', 'execute')
  and has_function_privilege('authenticated', 'public.create_outfit_draft(uuid,date,text)', 'execute'),
  'execute は authenticated にだけ許可されている');

-- どの確定・編集のあとも「いつも成り立つこと」を確かめた
select test.assert(
  (select count(*) from test.inv_calls) = 8,
  'どの確定・編集のあとも、上の2つの「いつも成り立つこと」が成り立つ（確かめる関数を作って毎回呼ぶ）');

rollback;
