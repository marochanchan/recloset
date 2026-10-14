-- =========================================
-- migration 019 のテスト用: 019 を適用する前からある既存データ
-- （ローカルのDockerのPostgres専用。本番では実行しない）
--
-- 019 の初期作成（既存データからの行動）を確かめるため、019 の前に postgres で入れる。
-- 時刻は日本時間の日付の境界をまたぐように置く
-- =========================================
\set ON_ERROR_STOP on
\set A 'aaaaaaaa-0000-4000-8000-00000000000a'
\set B 'bbbbbbbb-0000-4000-8000-00000000000b'
\set A_ITEM1 'a1a1a1a1-0000-4000-8000-0000000000a1'
\set A_ITEM2 'a2a2a2a2-0000-4000-8000-0000000000a2'
\set A_SESSION 'a5a5a5a5-0000-4000-8000-0000000000a5'

insert into auth.users (id) values (:'A'), (:'B');

-- A の服2着（ITEM2 はカテゴリを仕分け済み）
insert into public.clothing_items (id, user_id, title, category, created_at, category_classified_at)
values
  (:'A_ITEM1', :'A', 'シャツ', 'tops', '2026-01-10T01:00:00Z', null),
  (:'A_ITEM2', :'A', '写真から登録した服', 'other', '2026-01-10T02:00:00Z', '2026-01-12T03:00:00Z');

-- 着用記録: 日本時間 1/10 23:59（UTC 14:59）、1/11 00:00（UTC 15:00）、1/11 12:00
insert into public.wear_logs (id, clothing_item_id, worn_at)
values
  ('c1c1c1c1-0000-4000-8000-0000000000c1', :'A_ITEM1', '2026-01-10T14:59:00Z'),
  ('c2c2c2c2-0000-4000-8000-0000000000c2', :'A_ITEM1', '2026-01-10T15:00:00Z'),
  ('c3c3c3c3-0000-4000-8000-0000000000c3', :'A_ITEM2', '2026-01-11T03:00:00Z');

-- AI診断
insert into public.ai_diagnoses
  (id, clothing_item_id, user_id, decision, decision_probabilities, fact, feeling, next_action, model, created_at)
values
  ('d1d1d1d1-0000-4000-8000-0000000000d1', :'A_ITEM1', :'A', 'KEEP', '{}', '{}', '{}', '{}', 'test',
   '2026-01-13T01:00:00Z');

-- スワイプ見直し（keep と skip。skip は行動にしない）
insert into public.closet_review_sessions (id, user_id, item_ids, created_at, completed_at)
values (:'A_SESSION', :'A', array[:'A_ITEM1', :'A_ITEM2']::uuid[], '2026-01-13T02:00:00Z', '2026-01-13T02:10:00Z');
insert into public.closet_review_decisions (id, session_id, user_id, clothing_item_id, decision, created_at)
values
  ('e1e1e1e1-0000-4000-8000-0000000000e1', :'A_SESSION', :'A', :'A_ITEM1', 'keep', '2026-01-13T02:01:00Z'),
  ('e2e2e2e2-0000-4000-8000-0000000000e2', :'A_SESSION', :'A', :'A_ITEM2', 'skip', '2026-01-13T02:02:00Z');
