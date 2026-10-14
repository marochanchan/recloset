-- =========================================
-- migration 019（closet_activity_events）のテスト
-- （ローカルのDockerのPostgres専用。本番では実行しない）
--
-- 前提: 019_before_setup.sql（019 適用前の既存データ）→ 019 の順に適用済み。
-- /tmp/019_backfill.sql に 019 の「5. 既存データからの初期作成」だけを
-- 抜き出したものがあること（run-019.sh が用意する）。
-- 確認は postgres（RLSの対象外）で行い、操作は authenticated / anon で行う。
-- =========================================
\set ON_ERROR_STOP on
\set A 'aaaaaaaa-0000-4000-8000-00000000000a'
\set B 'bbbbbbbb-0000-4000-8000-00000000000b'
\set A_ITEM1 'a1a1a1a1-0000-4000-8000-0000000000a1'
\set A_ITEM2 'a2a2a2a2-0000-4000-8000-0000000000a2'
\set A_ITEM3 'a3a3a3a3-0000-4000-8000-0000000000a3'
\set A_SESSION2 'a6a6a6a6-0000-4000-8000-0000000000a6'
\set B_ITEM 'b1b1b1b1-0000-4000-8000-0000000000b1'
\set B_SESSION 'b5b5b5b5-0000-4000-8000-0000000000b5'

create schema if not exists test;
grant usage on schema test to anon, authenticated;
create or replace function test.assert(cond boolean, msg text) returns void
language plpgsql as $$
begin
  if cond is not true then
    raise exception 'FAIL: %', msg;
  end if;
  raise notice 'ok: %', msg;
end;
$$;
create or replace function test.expect_denied(stmt text, msg text) returns void
language plpgsql as $$
begin
  begin
    execute stmt;
  exception when insufficient_privilege then
    raise notice 'ok (denied): %', msg;
    return;
  end;
  raise exception 'FAIL (not denied): %', msg;
end;
$$;
grant execute on all functions in schema test to anon, authenticated;

-- postgres で数える（RLSの対象外）
create or replace function test.event_count(p_user uuid, p_action text default null)
returns integer language sql as $$
  select count(*)::integer from public.closet_activity_events
  where user_id = p_user and (p_action is null or action = p_action);
$$;

-- -----------------------------------------
-- 1. テーブル定義・RLS・GRANT・関数の権限
-- -----------------------------------------
select test.assert(
  (select relrowsecurity from pg_class where oid = 'public.closet_activity_events'::regclass),
  'RLSが有効');
select test.assert(
  (select string_agg(policyname || ':' || cmd, ',' order by policyname)
   from pg_policies where schemaname = 'public' and tablename = 'closet_activity_events')
  = 'closet_activity_events_select_own:SELECT',
  'ポリシーは本人のSELECTだけ');
select test.assert(
  has_table_privilege('authenticated', 'public.closet_activity_events', 'select')
    and not has_table_privilege('authenticated', 'public.closet_activity_events', 'insert')
    and not has_table_privilege('authenticated', 'public.closet_activity_events', 'update')
    and not has_table_privilege('authenticated', 'public.closet_activity_events', 'delete'),
  'authenticated は SELECT だけ');
select test.assert(
  not has_table_privilege('anon', 'public.closet_activity_events', 'select')
    and not has_table_privilege('anon', 'public.closet_activity_events', 'insert'),
  'anon には何も与えない');
select test.assert(
  has_function_privilege('authenticated', 'public.get_closet_activity_kind_day_counts()', 'execute')
    and not has_function_privilege('anon', 'public.get_closet_activity_kind_day_counts()', 'execute'),
  '集計RPCは authenticated だけ実行できる');
select test.assert(
  not has_function_privilege('authenticated', 'public.log_clothing_item_activity()', 'execute')
    and not has_function_privilege('authenticated', 'public.log_wear_log_activity()', 'execute')
    and not has_function_privilege('authenticated', 'public.log_ai_diagnosis_activity()', 'execute')
    and not has_function_privilege('authenticated', 'public.log_review_decision_activity()', 'execute')
    and not has_function_privilege('anon', 'public.log_clothing_item_activity()', 'execute'),
  'トリガー関数は直接実行できない');
select test.assert(
  (select bool_and(prosecdef and proconfig @> array['search_path=""'])
   from pg_proc
   where proname in ('log_clothing_item_activity', 'log_wear_log_activity',
                     'log_ai_diagnosis_activity', 'log_review_decision_activity')),
  'トリガー関数は security definer で search_path を固定');
select test.assert(
  (select not prosecdef and proconfig @> array['search_path=""']
   from pg_proc where proname = 'get_closet_activity_kind_day_counts'),
  '集計RPCは security invoker で search_path を固定');

-- -----------------------------------------
-- 2. 既存データからの初期作成
-- -----------------------------------------
select test.assert(test.event_count(:'A') = 8,
  '初期作成: 登録2・着用3・AI診断1・スワイプ1（skip除く）・カテゴリ仕分け1 = 8件');
select test.assert(test.event_count(:'A', 'swipe_review') = 1, '初期作成: skip は行動にしない');
select test.assert(test.event_count(:'A', 'seasons_classified') = 0
    and test.event_count(:'A', 'status_candidate') = 0,
  '初期作成: 季節・状態変更は記録がないため作らない');
select test.assert(
  (select bool_and((detail ->> 'backfilled')::boolean)
   from public.closet_activity_events where user_id = :'A'),
  '初期作成の行動には backfilled = true');
select test.assert(
  (select occurred_at = '2026-01-10T15:00:00Z'
   from public.closet_activity_events
   where dedupe_key = 'wear_logs:c2c2c2c2-0000-4000-8000-0000000000c2'),
  '初期作成は元の記録の時刻を使う');
select test.assert(
  (select occurred_at = '2026-01-12T03:00:00Z'
   from public.closet_activity_events where action = 'category_classified' and user_id = :'A'),
  '初期作成: カテゴリ仕分けは category_classified_at の時刻');
select test.assert(
  (select count(*) from public.clothing_items) = 2
    and (select count(*) from public.wear_logs) = 3,
  '既存テーブルのデータは変わらない');

-- 初期作成をもう一度実行しても二重にならない
\i /tmp/019_backfill.sql
select test.assert(test.event_count(:'A') = 8, '初期作成を再実行しても8件のまま');

-- カテゴリ仕分けの初期作成とトリガーが同じキーになる（同じ値の再保存で二重にならない）
update public.clothing_items set category_classified_at = category_classified_at
where id = :'A_ITEM2';
select test.assert(test.event_count(:'A', 'category_classified') = 1,
  '同じ category_classified_at の再保存では増えない');

-- -----------------------------------------
-- 3. 集計RPC（日本時間の日付 × kind の日数）
-- -----------------------------------------
set role authenticated;
select set_config('request.jwt.claim.sub', :'A', false);
select test.assert(
  (select string_agg(kind || '=' || day_count, ',' order by kind)
   from public.get_closet_activity_kind_day_counts())
  = 'organize=1,register=1,review=1,wear=2',
  'RPC: 日本時間で日付を分ける（UTC 14:59 と 15:00 は別の日）。同じ日の同じ種類は1日');
select test.assert(
  (select count(*) from public.closet_activity_events) = 8,
  'A は自分の行動を読める');

select set_config('request.jwt.claim.sub', :'B', false);
select test.assert(
  (select count(*) from public.closet_activity_events) = 0,
  'B には A の行動が見えない');
select test.assert(
  (select count(*) from public.get_closet_activity_kind_day_counts()) = 0,
  'RPC: B には A の集計を返さない');
reset role;

set role anon;
select set_config('request.jwt.claim.sub', '', false);
select test.expect_denied(
  'select count(*) from public.closet_activity_events', 'anon は行動を読めない');
select test.expect_denied(
  'select * from public.get_closet_activity_kind_day_counts()', 'anon はRPCを実行できない');
reset role;

-- -----------------------------------------
-- 4. クライアントから直接は書けない
-- -----------------------------------------
set role authenticated;
select set_config('request.jwt.claim.sub', :'A', false);
select test.expect_denied(format(
  'insert into public.closet_activity_events (user_id, kind, action, occurred_at, source_table, source_id, dedupe_key) '
  'values (%L, ''wear'', ''wear_logged'', now(), ''wear_logs'', gen_random_uuid(), ''forged'')', :'A'),
  'INSERT は拒否');
select test.expect_denied(
  'update public.closet_activity_events set revoked_at = now()', 'UPDATE は拒否');
select test.expect_denied(
  'delete from public.closet_activity_events', 'DELETE は拒否');
reset role;

-- -----------------------------------------
-- 5. INSERT由来の行動（トリガー）
-- -----------------------------------------
set role authenticated;
select set_config('request.jwt.claim.sub', :'A', false);
-- created_at を過去に偽っても、行動の時刻は記録した時刻
insert into public.clothing_items (id, user_id, title, category, created_at)
values (:'A_ITEM3', :'A', 'ニット', 'tops', '2020-01-01T00:00:00Z');
insert into public.wear_logs (clothing_item_id) values (:'A_ITEM3');
insert into public.ai_diagnoses
  (clothing_item_id, user_id, decision, decision_probabilities, fact, feeling, next_action, model)
values (:'A_ITEM3', :'A', 'KEEP', '{}', '{}', '{}', '{}', 'test');
insert into public.closet_review_sessions (id, item_ids)
values (:'A_SESSION2', array[:'A_ITEM3', :'A_ITEM2']::uuid[]);
insert into public.closet_review_decisions (session_id, clothing_item_id, decision)
values (:'A_SESSION2', :'A_ITEM3', 'keep'), (:'A_SESSION2', :'A_ITEM2', 'skip');
reset role;

select test.assert(
  (select occurred_at > now() - interval '1 hour' and user_id = :'A'
   from public.closet_activity_events
   where dedupe_key = 'clothing_items:' || :'A_ITEM3' || ':registered'),
  '登録: 記録した時刻で、所有者の user_id');
select test.assert(test.event_count(:'A', 'wear_logged') = 4, '着用: 1件増える');
select test.assert(test.event_count(:'A', 'ai_diagnosis') = 2, 'AI診断: 1件増える');
select test.assert(test.event_count(:'A', 'swipe_review') = 2, 'スワイプ: keep だけ1件増える（skip は増えない）');

-- 取り消し（1つ前に戻す）: 行は残し revoked_at を記録する
set role authenticated;
select set_config('request.jwt.claim.sub', :'A', false);
delete from public.closet_review_decisions
where session_id = :'A_SESSION2' and clothing_item_id = :'A_ITEM3';
reset role;
select test.assert(
  (select revoked_at is not null from public.closet_activity_events
   where action = 'swipe_review' and clothing_item_id = :'A_ITEM3'),
  '取り消し: 行動は残り、revoked_at が記録される');
select test.assert(test.event_count(:'A', 'swipe_review') = 2, '取り消し: 行は削除しない');

-- 取り消しは成長に数えない（B: 今日の見直しがスワイプ1件だけ）
set role authenticated;
select set_config('request.jwt.claim.sub', :'B', false);
insert into public.clothing_items (id, user_id, title, category)
values (:'B_ITEM', :'B', 'パンツ', 'bottoms');
insert into public.closet_review_sessions (id, item_ids) values (:'B_SESSION', array[:'B_ITEM']::uuid[]);
insert into public.closet_review_decisions (session_id, clothing_item_id, decision)
values (:'B_SESSION', :'B_ITEM', 'keep');
select test.assert(
  (select string_agg(kind || '=' || day_count, ',' order by kind)
   from public.get_closet_activity_kind_day_counts()) = 'register=1,review=1',
  'RPC: 見直しが数えられる');
delete from public.closet_review_decisions where session_id = :'B_SESSION';
select test.assert(
  (select string_agg(kind || '=' || day_count, ',' order by kind)
   from public.get_closet_activity_kind_day_counts()) = 'register=1',
  'RPC: 取り消した見直しは数えない');
-- やり直し（もう一度判断する）と、また数えられる
insert into public.closet_review_decisions (session_id, clothing_item_id, decision)
values (:'B_SESSION', :'B_ITEM', 'unsure');
select test.assert(
  (select string_agg(kind || '=' || day_count, ',' order by kind)
   from public.get_closet_activity_kind_day_counts()) = 'register=1,review=1',
  'RPC: やり直した判断は数える（同じ日なので1日のまま）');
reset role;

-- -----------------------------------------
-- 6. UPDATE由来の行動（値が変わったときだけ）
-- -----------------------------------------
set role authenticated;
select set_config('request.jwt.claim.sub', :'A', false);
update public.clothing_items set title = 'ニット（白）' where id = :'A_ITEM3';
update public.clothing_items set status = 'candidate' where id = :'A_ITEM3';
update public.clothing_items set status = 'candidate' where id = :'A_ITEM3';
update public.clothing_items set status = 'sold' where id = :'A_ITEM3';
update public.clothing_items set status = 'closet' where id = :'A_ITEM3';
update public.clothing_items set status = 'letting_go' where id = :'A_ITEM3';
update public.clothing_items set category_classified_at = '2026-10-15T00:00:00Z' where id = :'A_ITEM3';
update public.clothing_items set category_classified_at = '2026-10-15T00:00:00Z', category = 'tops'
  where id = :'A_ITEM3';
update public.clothing_items set seasons = '{spring}' where id = :'A_ITEM3';
update public.clothing_items set seasons = '{summer}' where id = :'A_ITEM3';
update public.clothing_items set seasons = '{}' where id = :'A_ITEM3';
update public.clothing_items set seasons = '{winter}' where id = :'A_ITEM3';
reset role;

select test.assert(
  (select count(*) from public.closet_activity_events
   where clothing_item_id = :'A_ITEM3' and action like 'status_%') = 3,
  '状態変更: candidate・sold・letting_go の3件（同じ値・closet への変更は数えない）');
select test.assert(
  (select kind = 'organize' and detail ->> 'from_status' = 'closet'
   from public.closet_activity_events
   where clothing_item_id = :'A_ITEM3' and action = 'status_candidate'),
  '手放し候補は整理（organize）');
select test.assert(
  (select bool_and(kind = 'circulate') from public.closet_activity_events
   where clothing_item_id = :'A_ITEM3' and action in ('status_sold', 'status_letting_go')),
  '出品中・売却済みは循環（circulate）');
select test.assert(
  (select count(*) from public.closet_activity_events
   where clothing_item_id = :'A_ITEM3' and action = 'category_classified') = 1,
  'カテゴリ仕分け: 同じ値の再保存では増えない');
select test.assert(
  (select count(*) from public.closet_activity_events
   where clothing_item_id = :'A_ITEM3' and action = 'seasons_classified') = 2,
  '季節: 未設定から設定したときだけ（設定済みの変更は数えない）');
select test.assert(
  (select count(*) from public.closet_activity_events
   where clothing_item_id = :'A_ITEM3' and action = 'item_registered') = 1,
  'UPDATE では登録の行動は増えない');

-- 同じトランザクション内の正当な変更は、それぞれ記録される（キーが重ならない）
set role authenticated;
select set_config('request.jwt.claim.sub', :'A', false);
begin;
update public.clothing_items set status = 'candidate' where id = :'A_ITEM2';
update public.clothing_items set status = 'closet' where id = :'A_ITEM2';
update public.clothing_items set status = 'candidate' where id = :'A_ITEM2';
update public.clothing_items set seasons = '{spring}' where id = :'A_ITEM2';
update public.clothing_items set seasons = '{}' where id = :'A_ITEM2';
update public.clothing_items set seasons = '{autumn}' where id = :'A_ITEM2';
commit;
reset role;
select test.assert(
  (select count(*) from public.closet_activity_events
   where clothing_item_id = :'A_ITEM2' and action = 'status_candidate') = 2,
  '同じトランザクション内で2回手放し候補にすると2件（一意制約違反にならない）');
select test.assert(
  (select count(*) from public.closet_activity_events
   where clothing_item_id = :'A_ITEM2' and action = 'seasons_classified') = 2,
  '同じトランザクション内で2回季節を設定すると2件');

-- 行動履歴の記録に失敗しても、元の保存は失敗しない（WARNINGを出して続行）
alter table public.closet_activity_events
  add constraint test_block_wear check (action <> 'wear_logged') not valid;
select test.event_count(:'A', 'wear_logged') as wear_before \gset
set role authenticated;
select set_config('request.jwt.claim.sub', :'A', false);
insert into public.wear_logs (id, clothing_item_id)
values ('c9c9c9c9-0000-4000-8000-0000000000c9', :'A_ITEM3');
reset role;
select test.assert(
  exists (select 1 from public.wear_logs where id = 'c9c9c9c9-0000-4000-8000-0000000000c9'),
  '記録に失敗しても着用記録は保存される');
select test.assert(test.event_count(:'A', 'wear_logged') = :wear_before,
  '記録に失敗した行動は増えない（欠落はWARNINGで分かる）');
alter table public.closet_activity_events drop constraint test_block_wear;

-- -----------------------------------------
-- 7. 服を削除しても行動は残る（cascade は取り消しではない）
-- -----------------------------------------
select test.event_count(:'A') as before_delete \gset
set role authenticated;
select set_config('request.jwt.claim.sub', :'A', false);
delete from public.clothing_items where id = :'A_ITEM1';
reset role;
select test.assert(test.event_count(:'A') = :before_delete, '服を削除しても行動の件数は変わらない');
select test.assert(
  (select clothing_item_id is null and revoked_at is null
   from public.closet_activity_events
   where dedupe_key = 'closet_review_decisions:e1e1e1e1-0000-4000-8000-0000000000e1'),
  '削除した服の見直しは残り（clothing_item_id は null）、取り消し扱いにしない');
select test.assert(
  (select count(*) from public.closet_activity_events
   where dedupe_key in ('wear_logs:c1c1c1c1-0000-4000-8000-0000000000c1',
                        'wear_logs:c2c2c2c2-0000-4000-8000-0000000000c2',
                        'ai_diagnoses:d1d1d1d1-0000-4000-8000-0000000000d1')
     and clothing_item_id is null) = 3,
  '削除した服の着用・AI診断の行動も残る');
set role authenticated;
select set_config('request.jwt.claim.sub', :'A', false);
select test.assert(
  (select day_count from public.get_closet_activity_kind_day_counts() where kind = 'wear') >= 2,
  'RPC: 削除した服の過去の着用も数え続ける');
reset role;

select 'PASSED: 019' as result;
