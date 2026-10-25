-- =========================================
-- migration 021（サマリーの作り直しと派生値）のテスト
-- （ローカルのDockerのPostgres専用。本番では実行しない）
--
-- 事実（コーデ・着用記録）は postgres で直接入れ、関数を呼んでから確かめる。
-- 全体を begin〜rollback で包む（ユーザー C のデータには触らない）
-- =========================================
\set ON_ERROR_STOP on
\set A 'aaaaaaaa-0000-4000-8000-00000000000a'
\set T 'a1a1a1a1-0000-4000-8000-0000000000a1'
\set D 'a2a2a2a2-0000-4000-8000-0000000000a2'
\set G 'a3a3a3a3-0000-4000-8000-0000000000a3'
\set W 'a4a4a4a4-0000-4000-8000-0000000000a4'
\set S 'a5a5a5a5-0000-4000-8000-0000000000a5'
\set X 'a6a6a6a6-0000-4000-8000-0000000000a6'

begin;

-- -----------------------------------------
-- 準備（postgres）
-- A の既存の着用記録は消して、このテストの事実だけにする
-- -----------------------------------------
delete from public.wear_logs
 where clothing_item_id in (select id from public.clothing_items where user_id = :'A');

insert into public.clothing_items (id, user_id, title, category, wear_count)
values
  (:'W', :'A', 'ワンピース', 'tops', 0),
  (:'S', :'A', 'スカート', 'bottoms', 0),
  -- 着用記録がない服。wear_count をわざと間違えておく
  (:'X', :'A', '記録なし', 'tops', 5);

-- コーデ: 確定3件 + 1着だけの確定1件 + 確認待ち1件
insert into public.outfits (id, user_id, worn_on, source, status)
values
  ('a0000020-0000-4000-8000-000000000020', :'A', '2026-10-20', 'manual', 'confirmed'),
  ('a0000022-0000-4000-8000-000000000022', :'A', '2026-10-22', 'manual', 'confirmed'),
  ('a0000023-0000-4000-8000-000000000023', :'A', '2026-10-23', 'manual', 'confirmed'),
  ('a0000021-0000-4000-8000-000000000021', :'A', '2026-10-21', 'manual', 'confirmed'),
  ('a0000024-0000-4000-8000-000000000024', :'A', '2026-10-24', 'manual', 'pending');

-- コーデの服ごとに着用記録（日本時間 12:00）をひも付ける。確認待ちには記録を付けない
create temp table _oi (outfit text, item uuid, d date) on commit drop;
insert into _oi values
  ('a0000020-0000-4000-8000-000000000020', :'T', '2026-10-20'),
  ('a0000020-0000-4000-8000-000000000020', :'D', '2026-10-20'),
  ('a0000020-0000-4000-8000-000000000020', :'G', '2026-10-20'),
  ('a0000022-0000-4000-8000-000000000022', :'T', '2026-10-22'),
  ('a0000022-0000-4000-8000-000000000022', :'D', '2026-10-22'),
  ('a0000022-0000-4000-8000-000000000022', :'S', '2026-10-22'),
  ('a0000023-0000-4000-8000-000000000023', :'W', '2026-10-23'),
  ('a0000023-0000-4000-8000-000000000023', :'D', '2026-10-23'),
  ('a0000023-0000-4000-8000-000000000023', :'G', '2026-10-23'),
  ('a0000021-0000-4000-8000-000000000021', :'G', '2026-10-21');

insert into public.wear_logs (id, clothing_item_id, worn_at, source)
select gen_random_uuid(), item, (d + time '12:00') at time zone 'Asia/Tokyo', 'outfit' from _oi;

insert into public.outfit_items (outfit_id, item_id, user_id, wear_log_id)
select o.outfit::uuid, o.item, :'A', wl.id
  from _oi o
  join public.wear_logs wl
    on wl.clothing_item_id = o.item
   and wl.worn_at = (o.d + time '12:00') at time zone 'Asia/Tokyo';

insert into public.outfit_items (outfit_id, item_id, user_id)
values
  ('a0000024-0000-4000-8000-000000000024', :'T', :'A'),
  ('a0000024-0000-4000-8000-000000000024', :'W', :'A');

-- 「今日着た」の記録（10/22 の T は同じ日の重複。もう1件は D の 10/21）と、月またぎの記録
insert into public.wear_logs (clothing_item_id, worn_at)
values
  (:'T', '2026-10-22T11:00:00Z'),
  (:'D', '2026-10-21T01:00:00Z'),
  (:'S', '2026-10-31T14:30:00Z'),   -- 10/31 23:30 JST
  (:'S', '2026-10-31T15:30:00Z');   -- 11/1 00:30 JST

-- -----------------------------------------
-- 月ごとの作り直し
-- -----------------------------------------
select public.rebuild_monthly_stats(:'A', '2026-10-01');
select public.rebuild_monthly_stats(:'A', '2026-11-01');

select test.assert(
  (select wear_log_count = 3 and worn_days = 2 and outfit_count = 2 and last_worn_on = '2026-10-22'
     from public.item_monthly_stats
    where user_id = :'A' and item_id = :'T' and month = '2026-10-01'),
  'T の 2026-10：wear_log_count=3、worn_days=2、outfit_count=2、last_worn_on=2026-10-22');

select test.assert(
  (select outfit_count = 2 and together_days = 2 and last_worn_on = '2026-10-22'
     from public.item_pair_monthly_stats
    where user_id = :'A' and item_a = least(:'D'::uuid, :'T'::uuid)
      and item_b = greatest(:'D'::uuid, :'T'::uuid) and month = '2026-10-01'),
  '(D,T) の組：outfit_count=2、together_days=2、last_worn_on=2026-10-22');

select test.assert(
  (select outfit_count from public.item_pair_monthly_stats
    where user_id = :'A' and item_a = least(:'D'::uuid, :'G'::uuid)
      and item_b = greatest(:'D'::uuid, :'G'::uuid) and month = '2026-10-01') = 2,
  '(D,G) の組：outfit_count=2');

select test.assert(
  not exists (select 1 from public.item_pair_monthly_stats
               where user_id = :'A' and month = '2026-10-01'
                 and item_a = least(:'T'::uuid, :'W'::uuid)
                 and item_b = greatest(:'T'::uuid, :'W'::uuid)),
  '確認待ちの (T,W) の組の行はない');

select test.assert(
  (select outfit_count from public.outfit_combo_monthly_stats
    where user_id = :'A' and month = '2026-10-01'
      and combo_key = md5((select string_agg(i::text, ',' order by i)
                             from unnest(array[:'T'::uuid, :'D'::uuid, :'G'::uuid]) i))) = 1,
  'combo (T,D,G) の outfit_count=1');

select test.assert(
  (select count(*) from public.outfit_combo_monthly_stats
    where user_id = :'A' and month = '2026-10-01') = 3,
  '服が1着のコーデは combo を作らない（combo は3件）');

select test.assert(
  (select wear_log_count from public.item_monthly_stats
    where user_id = :'A' and item_id = :'S' and month = '2026-10-01') = 2
  and (select wear_log_count from public.item_monthly_stats
    where user_id = :'A' and item_id = :'S' and month = '2026-11-01') = 1,
  '10/31 23:30 JST の記録は10月、11/1 0:30 JST の記録は11月に入る');

select test.assert(
  (select outfit_count from public.item_monthly_stats
    where user_id = :'A' and item_id = :'W' and month = '2026-10-01') = 1,
  '確認待ちのコーデは outfit_count に数えない（W は確定の10/23の1回だけ）');

-- -----------------------------------------
-- rebuild_all_stats は、月ごとの作り直しと同じ結果になる
-- -----------------------------------------
create temp table _m_item on commit drop as
  select user_id, item_id, month, wear_log_count, worn_days, outfit_count, last_worn_on
    from public.item_monthly_stats where user_id = :'A';
create temp table _m_pair on commit drop as
  select user_id, item_a, item_b, month, outfit_count, together_days, last_worn_on
    from public.item_pair_monthly_stats where user_id = :'A';
create temp table _m_combo on commit drop as
  select user_id, combo_key, item_ids, month, outfit_count, last_worn_on
    from public.outfit_combo_monthly_stats where user_id = :'A';

select public.rebuild_all_stats(:'A');

select test.assert(
  not exists (
    (select user_id, item_id, month, wear_log_count, worn_days, outfit_count, last_worn_on
       from public.item_monthly_stats where user_id = :'A'
     except select * from _m_item)
    union all
    (select * from _m_item
     except select user_id, item_id, month, wear_log_count, worn_days, outfit_count, last_worn_on
       from public.item_monthly_stats where user_id = :'A'))
  and not exists (
    (select user_id, item_a, item_b, month, outfit_count, together_days, last_worn_on
       from public.item_pair_monthly_stats where user_id = :'A'
     except select * from _m_pair)
    union all
    (select * from _m_pair
     except select user_id, item_a, item_b, month, outfit_count, together_days, last_worn_on
       from public.item_pair_monthly_stats where user_id = :'A'))
  and not exists (
    (select user_id, combo_key, item_ids, month, outfit_count, last_worn_on
       from public.outfit_combo_monthly_stats where user_id = :'A'
     except select * from _m_combo)
    union all
    (select * from _m_combo
     except select user_id, combo_key, item_ids, month, outfit_count, last_worn_on
       from public.outfit_combo_monthly_stats where user_id = :'A')),
  'rebuild_all_stats の結果が、月ごとに作り直した結果と完全に一致する（差が0行）');

-- -----------------------------------------
-- recompute_item_wear
-- -----------------------------------------
select test.assert(
  (select wear_count = 3 and last_worn_at = '2026-10-22T11:00:00Z'
     from public.clothing_items where id = :'T'),
  'recompute_item_wear：T の wear_count=3、last_worn_at が最新の記録');
select test.assert(
  (select wear_count = 0 and last_worn_at is null from public.clothing_items where id = :'X'),
  'recompute_item_wear：記録がない服は 0 と null');

update public.clothing_items set wear_count = 99, last_worn_at = null where id = :'D';
select public.recompute_item_wear(array[:'D'::uuid]);
select test.assert(
  (select wear_count = (select count(*) from public.wear_logs where clothing_item_id = :'D')
      and last_worn_at = (select max(worn_at) from public.wear_logs where clothing_item_id = :'D')
     from public.clothing_items where id = :'D'),
  'recompute_item_wear のあと、wear_count と last_worn_at が着用記録と一致する');

-- -----------------------------------------
-- 日付の関数
-- -----------------------------------------
select test.assert(
  public.outfit_worn_at('2026-10-01') = '2026-10-01 03:00:00+00',
  'outfit_worn_at(2026-10-01) = 2026-10-01 03:00:00+00');
select test.assert(
  public.outfit_worn_at(public.jst_date(now())) = now(),
  'outfit_worn_at(日本時間の今日) = now()');
select test.assert(
  public.jst_date('2026-10-31T15:30:00Z') = '2026-11-01',
  'jst_date は日本時間の日付を返す');

-- -----------------------------------------
-- 権限（どのロールにも与えない）
-- -----------------------------------------
select test.expect_denied(
  format('set local role %s; select public.rebuild_monthly_stats(%L, %L)', r, :'A', '2026-10-01'),
  r || ' は rebuild_monthly_stats を呼べない')
  from unnest(array['authenticated', 'anon', 'service_role']) r;
select test.expect_denied(
  format('set local role %s; select public.rebuild_all_stats(%L)', r, :'A'),
  r || ' は rebuild_all_stats を呼べない')
  from unnest(array['authenticated', 'anon', 'service_role']) r;
select test.expect_denied(
  format('set local role %s; select public.recompute_item_wear(array[%L::uuid])', r, :'T'),
  r || ' は recompute_item_wear を呼べない')
  from unnest(array['authenticated', 'anon', 'service_role']) r;

-- -----------------------------------------
-- 10月の事実をすべて消して作り直すと、10月の行が0件になる
-- -----------------------------------------
delete from public.outfits where user_id = :'A';
delete from public.wear_logs
 where clothing_item_id in (select id from public.clothing_items where user_id = :'A');
select public.rebuild_monthly_stats(:'A', '2026-10-01');

select test.assert(
  (select count(*) from public.item_monthly_stats where user_id = :'A' and month = '2026-10-01')
  + (select count(*) from public.item_pair_monthly_stats where user_id = :'A' and month = '2026-10-01')
  + (select count(*) from public.outfit_combo_monthly_stats where user_id = :'A' and month = '2026-10-01') = 0,
  '10月の事実をすべて消して作り直すと、10月の行が3つのサマリーすべてで0件になる');

rollback;
