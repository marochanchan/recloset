-- =========================================
-- migration 020 のテスト用: 020 を適用する前からある既存データ
-- （ローカルのDockerのPostgres専用。本番では実行しない）
--
-- 020 の前に postgres で入れる。
-- A: 服3着・着用記録5件（2026-09 と 2026-10 にまたがる。日本時間の深夜0:30の記録を1件含む）
-- B: 服1着・着用記録1件
-- C: 服2着・記録なし（同時実行のテスト用。ほかのテストの assert では数えない）
-- =========================================
\set ON_ERROR_STOP on
\set A 'aaaaaaaa-0000-4000-8000-00000000000a'
\set B 'bbbbbbbb-0000-4000-8000-00000000000b'
\set C 'cccccccc-0000-4000-8000-00000000000c'
\set A_ITEM1 'a1a1a1a1-0000-4000-8000-0000000000a1'
\set A_ITEM2 'a2a2a2a2-0000-4000-8000-0000000000a2'
\set A_ITEM3 'a3a3a3a3-0000-4000-8000-0000000000a3'
\set B_ITEM 'b1b1b1b1-0000-4000-8000-0000000000b1'
\set C_ITEM1 'c1c1c1c1-0000-4000-8000-0000000000d1'
\set C_ITEM2 'c2c2c2c2-0000-4000-8000-0000000000d2'

insert into auth.users (id) values (:'A'), (:'B'), (:'C');

-- A の服3着。
-- A_ITEM3 の wear_count は実際の着用記録（1件）と違う 2 にしてある。
-- Task 10 のバックフィル（wear_count の補正）のテストで使う、わざと間違えた値
insert into public.clothing_items (id, user_id, title, category, wear_count)
values
  (:'A_ITEM1', :'A', 'シャツ', 'tops', 2),
  (:'A_ITEM2', :'A', 'パンツ', 'bottoms', 2),
  (:'A_ITEM3', :'A', 'コート', 'outerwear', 2);
insert into public.clothing_items (id, user_id, title, category, wear_count)
values
  (:'B_ITEM', :'B', 'Bの服', 'tops', 1),
  (:'C_ITEM1', :'C', 'Cの服1', 'tops', 0),
  (:'C_ITEM2', :'C', 'Cの服2', 'bottoms', 0);

-- A の着用記録5件（日本時間 2026-09-30 の夜〜2026-10 にまたがる）
--   a1: 2026-10-01 00:30 JST（= UTC 2026-09-30 15:30）。日本時間では10月
insert into public.wear_logs (id, clothing_item_id, worn_at)
values
  ('a1a10001-0000-4000-8000-000000000001', :'A_ITEM1', '2026-09-10T03:00:00Z'),
  ('a1a10002-0000-4000-8000-000000000002', :'A_ITEM1', '2026-09-30T15:30:00Z'),
  ('a1a10003-0000-4000-8000-000000000003', :'A_ITEM2', '2026-10-05T03:00:00Z'),
  ('a1a10004-0000-4000-8000-000000000004', :'A_ITEM2', '2026-10-12T03:00:00Z'),
  ('a1a10005-0000-4000-8000-000000000005', :'A_ITEM3', '2026-10-20T03:00:00Z');

-- B の着用記録1件
insert into public.wear_logs (id, clothing_item_id, worn_at)
values ('b1b10001-0000-4000-8000-000000000001', :'B_ITEM', '2026-10-02T03:00:00Z');
