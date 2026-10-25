-- =========================================
-- migration 024（書き込み権限の締め付けと初期集計）のテスト
-- （ローカルのDockerのPostgres専用。本番では実行しない）
--
-- 020_before_setup.sql の既存データに対して、024 のバックフィルが動いたあとの状態を確かめる。
-- A_ITEM3 の wear_count は before_setup でわざと 2 にしてある（記録は1件）。
-- 全体を begin〜rollback で包む
-- =========================================
\set ON_ERROR_STOP on
\set A 'aaaaaaaa-0000-4000-8000-00000000000a'
\set B 'bbbbbbbb-0000-4000-8000-00000000000b'
\set A_ITEM1 'a1a1a1a1-0000-4000-8000-0000000000a1'
\set A_ITEM2 'a2a2a2a2-0000-4000-8000-0000000000a2'
\set A_ITEM3 'a3a3a3a3-0000-4000-8000-0000000000a3'
\set B_ITEM 'b1b1b1b1-0000-4000-8000-0000000000b1'
\set NEW_ITEM 'f0240001-0000-4000-8000-000000000001'
\set NEW_ITEM2 'f0240002-0000-4000-8000-000000000002'

begin;

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

grant execute on all functions in schema test to anon, authenticated, service_role;

-- -----------------------------------------
-- 初期集計（postgres で確かめる）
-- -----------------------------------------
select test.as_postgres();

select test.assert(
  (select count(*) from public.item_monthly_stats
    where user_id = :'A' and month in ('2026-09-01', '2026-10-01')) = 4,
  'A の 2026-09 と 2026-10 の item_monthly_stats ができている（シャツ9月・10月、パンツ10月、コート10月の4行）');

select test.assert(
  not exists (
    select 1
      from public.item_monthly_stats s
      left join (
        select ci.user_id, wl.clothing_item_id as item_id,
               date_trunc('month', (wl.worn_at at time zone 'Asia/Tokyo'))::date as month,
               count(*) as n
          from public.wear_logs wl
          join public.clothing_items ci on ci.id = wl.clothing_item_id
         where ci.user_id = :'A'
         group by 1, 2, 3
      ) x on x.user_id = s.user_id and x.item_id = s.item_id and x.month = s.month
     where s.user_id = :'A' and x.n is distinct from s.wear_log_count
  ),
  'A の item_monthly_stats の件数が、既存の着用記録（日本時間の月ごと）と一致する');

select test.assert(
  (select wear_log_count from public.item_monthly_stats
    where item_id = :'A_ITEM1' and month = '2026-10-01') = 1,
  '日本時間の深夜0:30（UTC では9月）の記録は10月に数えられている');

select test.assert(
  (select wear_count from public.clothing_items where id = :'A_ITEM3') = 1,
  'wear_count がずれていたコート（A_ITEM3）が、記録の件数 1 に直っている');

select test.assert(
  (select last_worn_at from public.clothing_items where id = :'A_ITEM3') = '2026-10-20T03:00:00Z',
  'コートの last_worn_at が最新の記録に直っている');

select test.assert(
  not exists (
    select 1 from public.clothing_items ci
     where ci.user_id in (:'A', :'B')
       and (ci.wear_count is distinct from (select count(*) from public.wear_logs wl where wl.clothing_item_id = ci.id)
         or ci.last_worn_at is distinct from (select max(wl.worn_at) from public.wear_logs wl where wl.clothing_item_id = ci.id))),
  'A・B の全部の服で wear_count と last_worn_at が、記録から計算した値と一致する');

select test.assert(
  (select count(*) from public.item_pair_monthly_stats) = 0
  and (select count(*) from public.outfit_combo_monthly_stats) = 0,
  '2着の関係とコーデのサマリーは0件（推測で作らない）');

-- 列の権限そのもの（動作のテストだけでは、余分な grant を見逃すため）
select test.assert(
  not has_column_privilege('authenticated', 'public.clothing_items', 'wear_count', 'update')
  and not has_column_privilege('authenticated', 'public.clothing_items', 'last_worn_at', 'update')
  and not has_column_privilege('authenticated', 'public.clothing_items', 'archived_at', 'update')
  and not has_column_privilege('authenticated', 'public.clothing_items', 'id', 'update')
  and not has_column_privilege('authenticated', 'public.clothing_items', 'user_id', 'update')
  and not has_column_privilege('authenticated', 'public.clothing_items', 'created_at', 'update'),
  '除外した列（wear_count・last_worn_at・archived_at・id・user_id・created_at）に update の権限がない');

select test.assert(
  not has_column_privilege('authenticated', 'public.clothing_items', 'wear_count', 'insert')
  and not has_column_privilege('authenticated', 'public.clothing_items', 'last_worn_at', 'insert')
  and not has_column_privilege('authenticated', 'public.clothing_items', 'archived_at', 'insert')
  and has_column_privilege('authenticated', 'public.clothing_items', 'id', 'insert')
  and has_column_privilege('authenticated', 'public.clothing_items', 'user_id', 'insert'),
  'wear_count・last_worn_at・archived_at に insert の権限がなく、id・user_id にはある');

select test.assert(
  has_column_privilege('authenticated', 'public.clothing_items', 'title', 'update')
  and has_column_privilege('authenticated', 'public.clothing_items', 'status', 'update')
  and has_column_privilege('authenticated', 'public.clothing_items', 'is_public', 'update')
  and has_column_privilege('authenticated', 'public.clothing_items', 'published_at', 'update')
  and has_column_privilege('authenticated', 'public.clothing_items', 'category_classified_at', 'update'),
  '通常の列（title・status・is_public・published_at・category_classified_at）には update の権限がある');

-- 列の権限を information_schema.columns の全列と照らし合わせる
-- （あとの migration で列が足されて grant が漏れたら、ここで失敗する）
select test.assert(
  not exists (
    select 1 from information_schema.columns c
     where c.table_schema = 'public' and c.table_name = 'clothing_items'
       and has_column_privilege('authenticated', 'public.clothing_items', c.column_name, 'insert')
           is distinct from (c.column_name not in ('wear_count', 'last_worn_at', 'archived_at'))),
  'insert の権限は、wear_count・last_worn_at・archived_at 以外の全列にだけある（列の一覧と完全に一致）');
select test.assert(
  not exists (
    select 1 from information_schema.columns c
     where c.table_schema = 'public' and c.table_name = 'clothing_items'
       and has_column_privilege('authenticated', 'public.clothing_items', c.column_name, 'update')
           is distinct from (c.column_name not in ('id', 'user_id', 'created_at', 'wear_count', 'last_worn_at', 'archived_at'))),
  'update の権限は、id・user_id・created_at・wear_count・last_worn_at・archived_at 以外の全列にだけある（列の一覧と完全に一致）');

select test.assert(
  not has_table_privilege('authenticated', 'public.wear_logs', 'insert')
  and not has_table_privilege('authenticated', 'public.wear_logs', 'update')
  and not has_table_privilege('authenticated', 'public.wear_logs', 'delete')
  and not has_any_column_privilege('authenticated', 'public.wear_logs', 'insert')
  and not has_any_column_privilege('authenticated', 'public.wear_logs', 'update')
  and has_table_privilege('authenticated', 'public.wear_logs', 'select'),
  'wear_logs は authenticated に select だけが残っている');

select test.assert(
  has_table_privilege('authenticated', 'public.clothing_items', 'delete'),
  'clothing_items の delete の権限は今のまま残っている');

-- -----------------------------------------
-- wear_logs への直接の書き込み
-- -----------------------------------------
select test.as_user(:'A');

select test.expect_denied(
  format($$insert into public.wear_logs (clothing_item_id, worn_at) values (%L, now())$$, :'A_ITEM1'),
  'authenticated は wear_logs に insert できない');
select test.expect_denied(
  format($$update public.wear_logs set worn_at = now() where clothing_item_id = %L$$, :'A_ITEM1'),
  'authenticated は wear_logs を update できない');
select test.expect_denied(
  format($$delete from public.wear_logs where clothing_item_id = %L$$, :'A_ITEM1'),
  'authenticated は wear_logs を delete できない');

-- -----------------------------------------
-- clothing_items の update
-- -----------------------------------------
update public.clothing_items
   set title = 'シャツ（更新）', status = 'closet', is_public = false
 where id = :'A_ITEM1';
select test.assert(
  (select title from public.clothing_items where id = :'A_ITEM1') = 'シャツ（更新）',
  'authenticated は clothing_items の title・status・is_public を update できる');

select test.expect_denied(
  format($$update public.clothing_items set wear_count = 999 where id = %L$$, :'A_ITEM1'),
  'authenticated は wear_count を update できない');
select test.expect_denied(
  format($$update public.clothing_items set last_worn_at = now() where id = %L$$, :'A_ITEM1'),
  'authenticated は last_worn_at を update できない');
select test.expect_denied(
  format($$update public.clothing_items set archived_at = now() where id = %L$$, :'A_ITEM1'),
  'authenticated は archived_at を update できない');

-- -----------------------------------------
-- clothing_items の insert
-- -----------------------------------------
insert into public.clothing_items (id, user_id, title, category)
values (:'NEW_ITEM', :'A', '新しい服', 'tops');
select test.assert(
  (select wear_count from public.clothing_items where id = :'NEW_ITEM') = 0,
  'authenticated は id・user_id・title・category を指定して服を insert できる（今の登録処理と同じ形）');

select test.expect_denied(
  format($$insert into public.clothing_items (id, user_id, title, category, wear_count) values (%L, %L, 'x', 'tops', 999)$$, :'NEW_ITEM2', :'A'),
  'authenticated は wear_count = 999 を指定した insert ができない');
select test.expect_denied(
  format($$insert into public.clothing_items (id, user_id, title, category, last_worn_at) values (%L, %L, 'x', 'tops', now())$$, :'NEW_ITEM2', :'A'),
  'authenticated は last_worn_at を指定した insert ができない');
select test.expect_denied(
  format($$insert into public.clothing_items (id, user_id, title, category, archived_at) values (%L, %L, 'x', 'tops', now())$$, :'NEW_ITEM2', :'A'),
  'authenticated は archived_at を指定した insert ができない');

-- 登録失敗の取り消し（コーデに入っていない服の delete）
delete from public.clothing_items where id = :'NEW_ITEM';
select test.assert(
  not exists (select 1 from public.clothing_items where id = :'NEW_ITEM'),
  'authenticated は登録失敗の取り消し（コーデに入っていない服の delete）ができる');

-- -----------------------------------------
-- 着用記録のある服の直接 delete（仕様書 6.3 章）
-- -----------------------------------------
select test.as_postgres();
create temp table before_b as
  select (select count(*) from public.wear_logs where clothing_item_id = :'B_ITEM') as logs,
         (select count(*) from public.item_monthly_stats where item_id = :'B_ITEM') as stats;
grant select on before_b to authenticated;
select test.as_user(:'A');

delete from public.clothing_items where id = :'A_ITEM3';

select test.as_postgres();
select test.assert(
  not exists (select 1 from public.clothing_items where id = :'A_ITEM3')
  and not exists (select 1 from public.wear_logs where clothing_item_id = :'A_ITEM3')
  and not exists (select 1 from public.item_monthly_stats where item_id = :'A_ITEM3'),
  '着用記録のある服を直接 delete すると、その服の wear_logs と item_monthly_stats の行も消える');
select test.assert(
  (select count(*) from public.wear_logs where clothing_item_id = :'B_ITEM') = (select logs from before_b)
  and (select count(*) from public.item_monthly_stats where item_id = :'B_ITEM') = (select stats from before_b)
  and (select count(*) from public.wear_logs where clothing_item_id in (:'A_ITEM1', :'A_ITEM2')) = 4
  and (select count(*) from public.item_monthly_stats where item_id in (:'A_ITEM1', :'A_ITEM2')) = 3,
  'ほかの服（B の服、A のシャツとパンツ）の wear_logs と item_monthly_stats の行は変わらない');

-- -----------------------------------------
-- record_wear_today（authenticated）
-- -----------------------------------------
select test.as_user(:'A');
select test.assert(
  (public.record_wear_today(:'A_ITEM1')->>'created')::boolean = true,
  'record_wear_today は今日の記録を作る（created = true）');

select test.as_postgres();
select test.assert(
  (select wear_count from public.clothing_items where id = :'A_ITEM1') = 3
  and (select last_worn_at from public.clothing_items where id = :'A_ITEM1') >= now() - interval '1 minute',
  'record_wear_today で wear_count が1増え（2 -> 3）、last_worn_at が今になる');
select test.assert(
  (select count(*) from public.closet_activity_events e
    where e.user_id = :'A' and e.kind = 'wear' and e.clothing_item_id = :'A_ITEM1'
      and e.source_id = (select id from public.wear_logs
                          where clothing_item_id = :'A_ITEM1' and source = 'wear_today'
                          order by worn_at desc limit 1)) = 1,
  '019 の行動履歴に、record_wear_today の着用が1件記録される');

select test.as_user(:'A');
select test.assert(
  (public.record_wear_today(:'A_ITEM1')->>'created')::boolean = false,
  '同じ日の2回目の record_wear_today は created = false');

rollback;
