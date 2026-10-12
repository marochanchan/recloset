-- =========================================
-- migration 017（user_habit_settings）のテスト
-- （ローカルのDockerのPostgres専用。本番では実行しない）
--
-- upsert は、Data API（PostgREST）が supabase-js の
--   .upsert({ user_id, weekly_review_goal, updated_at }, { onConflict: "user_id" })
--   .select("weekly_review_goal")
-- から生成するSQLと同じ形（送った列すべてを DO UPDATE SET に含め、RETURNINGする）で実行する。
-- =========================================
\set ON_ERROR_STOP on
\set A 'aaaaaaaa-0000-4000-8000-00000000000a'
\set B 'bbbbbbbb-0000-4000-8000-00000000000b'

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
-- stmt が権限・RLSで拒否されることを確認する（拒否されなければ失敗）
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
-- stmt がCHECK制約で拒否されることを確認する
create or replace function test.expect_check_violation(stmt text, msg text) returns void
language plpgsql as $$
begin
  begin
    execute stmt;
  exception when check_violation then
    raise notice 'ok (check violation): %', msg;
    return;
  end;
  raise exception 'FAIL (not rejected): %', msg;
end;
$$;
-- PostgRESTのupsertと同じ形のSQL
create or replace function test.upsert_sql(p_user_id text, p_goal text) returns text
language sql as $$
  select format(
    'insert into public.user_habit_settings (user_id, weekly_review_goal, updated_at) '
    'values (%s, %s, now()) '
    'on conflict (user_id) do update set user_id = excluded.user_id, '
    'weekly_review_goal = excluded.weekly_review_goal, updated_at = excluded.updated_at '
    'returning weekly_review_goal',
    quote_nullable(p_user_id), coalesce(p_goal, 'null'));
$$;
grant execute on all functions in schema test to anon, authenticated;

insert into auth.users (id) values (:'A'), (:'B');

-- -----------------------------------------
-- 1. テーブル定義・RLS・GRANT
-- -----------------------------------------
select test.assert(
  (select relrowsecurity from pg_class where oid = 'public.user_habit_settings'::regclass),
  'RLSが有効');
select test.assert(
  (select string_agg(policyname || ':' || cmd, ',' order by policyname)
   from pg_policies where schemaname = 'public' and tablename = 'user_habit_settings')
  = 'user_habit_settings_insert_own:INSERT,user_habit_settings_select_own:SELECT,user_habit_settings_update_own:UPDATE',
  'ポリシーは SELECT/INSERT/UPDATE の3つだけ（DELETEなし）');
select test.assert(
  not has_table_privilege('anon', 'public.user_habit_settings', 'select')
    and not has_table_privilege('anon', 'public.user_habit_settings', 'insert')
    and not has_table_privilege('anon', 'public.user_habit_settings', 'update')
    and not has_table_privilege('anon', 'public.user_habit_settings', 'delete'),
  'anonには何の権限もない');
select test.assert(
  has_table_privilege('authenticated', 'public.user_habit_settings', 'select')
    and has_table_privilege('authenticated', 'public.user_habit_settings', 'insert')
    and has_table_privilege('authenticated', 'public.user_habit_settings', 'update'),
  'authenticatedは SELECT/INSERT/UPDATE できる');
select test.assert(
  not has_table_privilege('authenticated', 'public.user_habit_settings', 'delete')
    and not has_table_privilege('authenticated', 'public.user_habit_settings', 'truncate'),
  'authenticatedは DELETE/TRUNCATE できない');
select test.assert(
  not exists (
    select 1 from information_schema.role_table_grants
    where table_schema = 'public' and table_name = 'user_habit_settings' and grantee = 'PUBLIC'),
  'PUBLICには何の権限もない');

-- -----------------------------------------
-- 2. 本人（A）の操作
-- -----------------------------------------
set role authenticated;
select set_config('request.jwt.claim.sub', :'A', false);
select test.assert((select count(*) from public.user_habit_settings) = 0,
  '未保存なら行がない（アプリは週3着として扱う）');

select test.upsert_sql(:'A', '7') as q \gset
:q;
select test.assert((select weekly_review_goal from public.user_habit_settings) = 7,
  'upsertで行を作成できる（週7着）');
select test.upsert_sql(:'A', '14') as q \gset
:q;
select test.assert((select weekly_review_goal from public.user_habit_settings) = 14,
  'upsertで更新できる（週14着）');
select test.upsert_sql(:'A', null) as q \gset
:q;
select test.assert(
  (select count(*) from public.user_habit_settings where weekly_review_goal is null) = 1,
  'upsertで目標なし（null）を保存できる');
select test.upsert_sql(:'A', '3') as q \gset
:q;
select test.assert((select weekly_review_goal from public.user_habit_settings) = 3,
  'upsertで週3着に戻せる');
select test.assert((select count(*) from public.user_habit_settings) = 1,
  '何度保存しても本人の行は1行');

select test.expect_check_violation(test.upsert_sql(:'A', '5'), '3・7・14以外の値（5）は保存できない');
select test.expect_check_violation(test.upsert_sql(:'A', '0'), '0 は保存できない');
select test.expect_check_violation(test.upsert_sql(:'A', '-3'), '負の値は保存できない');
select test.expect_check_violation(test.upsert_sql(:'A', '21'), '選択肢にない大きい値は保存できない');
select test.assert((select weekly_review_goal from public.user_habit_settings) = 3,
  '拒否された保存のあとも値は変わらない');

select test.expect_denied(
  format('update public.user_habit_settings set user_id = %L', :'B'),
  '自分の行の user_id を他人のIDに書き換えられない');
select test.expect_denied('delete from public.user_habit_settings', '本人でも削除できない（DELETE権限なし）');
select test.expect_denied(test.upsert_sql(:'B', '7'), '他人（B）の行を作成できない');
reset role;

-- -----------------------------------------
-- 3. 他人（B）からのアクセス
-- -----------------------------------------
set role authenticated;
select set_config('request.jwt.claim.sub', :'B', false);
select test.assert((select count(*) from public.user_habit_settings) = 0,
  'BはAの設定を読めない');
update public.user_habit_settings set weekly_review_goal = 14 where user_id = :'A';
select test.expect_denied(test.upsert_sql(:'A', '14'),
  'BはAのIDを指定したupsertでAの設定を書き換えられない');
-- user_id を省略した保存（DEFAULT auth.uid()）は本人の行になる
insert into public.user_habit_settings (weekly_review_goal) values (14);
select test.assert(
  (select user_id::text from public.user_habit_settings) = :'B',
  'user_id を省略すると本人（auth.uid()）の行になる');
reset role;
select test.assert(
  (select weekly_review_goal from public.user_habit_settings where user_id = :'A') = 3,
  'Bの更新はAの行に影響しない（RLSで0件更新）');

-- -----------------------------------------
-- 4. 未ログイン（anon）
-- -----------------------------------------
set role anon;
select set_config('request.jwt.claim.sub', '', false);
select test.expect_denied('select * from public.user_habit_settings', 'anonは読めない');
select test.expect_denied(test.upsert_sql(:'A', '7'), 'anonは保存できない');
reset role;

-- -----------------------------------------
-- 5. 列単位のUPDATE権限にした場合（採用しなかった方式の確認）
-- PostgRESTのupsertは送った列（user_id を含む）を DO UPDATE SET に含めるため、
-- UPDATE権限を weekly_review_goal・updated_at に絞ると保存できない
-- -----------------------------------------
begin;
revoke update on public.user_habit_settings from authenticated;
grant update (weekly_review_goal, updated_at) on public.user_habit_settings to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub', :'A', true);
select test.expect_denied(test.upsert_sql(:'A', '7'),
  '[参考] 列単位のUPDATE権限では user_id を含むupsertが拒否される（テーブル単位にした理由）');
rollback;

-- -----------------------------------------
-- 6. ユーザー削除時
-- -----------------------------------------
delete from auth.users where id = :'B';
select test.assert(
  not exists (select 1 from public.user_habit_settings where user_id = :'B'),
  'ユーザーを削除すると設定も削除される（on delete cascade）');

\echo 'ALL 017 TESTS PASSED'
