-- =========================================
-- Re:Closet: 服登録の下書き（public.clothing_item_drafts）
--
-- 背景: 服の登録を途中で中断しても、入力済みの値と写真を失わず、
-- あとから続きを入力できるようにする。
--
-- 方針:
-- - clothing_items とは別テーブルにする。Closet・Today・AI診断・Loop・
--   公開RPC・件数のクエリは clothing_items だけを見るため、下書きは混ざらない。
-- - fields: 入力途中のフォームの値（jsonb）。値の検証・正規化はアプリ側
--   （lib/clothing-drafts.ts）で行う。
-- - image_paths: 写真の並び順（最大5枚）。写真は Storage の
--   {uid}/drafts/{draftId}/{uuid}.jpg に置く。先頭フォルダが本人のuidのため、
--   既存のStorageポリシー（003: 本人のフォルダだけ読み書き可）がそのまま効き、
--   公開中の服から参照されないため公開用ポリシー（008）の対象にもならない。
--   Storageのポリシーは変更しない。
-- - RLS: 本人（user_id = auth.uid()）だけが SELECT/INSERT/UPDATE/DELETE できる。
-- - GRANT: anon・PUBLICには何も与えない。authenticatedには上記4操作だけ。
--   （Supabaseの既定権限で付与される場合があるため、一度すべて取り消してから付与する）
-- - updated_at はアプリが保存のたびに設定する（DBトリガーは使わない）。
-- - 既存のテーブル・データ・公開RPCは変更しない。
--
-- 適用: Supabase SQL Editor で、このファイル全体を1回だけ実行する。
-- 注意: このファイルはまだSupabaseに実行していません。
-- 既存migration (001-013) は変更していません。
-- =========================================

begin;

create table public.clothing_item_drafts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid()
    references auth.users(id) on delete cascade,
  fields jsonb not null default '{}'::jsonb,
  image_paths text[] not null default '{}'::text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint clothing_item_drafts_fields_object
    check (jsonb_typeof(fields) = 'object'),
  constraint clothing_item_drafts_image_paths_max
    check (cardinality(image_paths) <= 5)
);

comment on table public.clothing_item_drafts is
  '服登録の下書き。本人だけが読み書きできる。登録が完了したら削除する。clothing_itemsとは独立しており、公開・Today・AI診断には使わない';
comment on column public.clothing_item_drafts.image_paths is
  'Storage clothing-images 内のパス（{uid}/drafts/{draftId}/{uuid}.jpg）。並び順どおり、最大5枚';

-- 下書き一覧（本人の新しい順）
create index idx_clothing_item_drafts_user_id_updated_at
  on public.clothing_item_drafts (user_id, updated_at desc);

-- -----------------------------------------
-- RLS: 本人だけ
-- -----------------------------------------
alter table public.clothing_item_drafts enable row level security;

create policy "clothing_item_drafts_select_own"
  on public.clothing_item_drafts for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy "clothing_item_drafts_insert_own"
  on public.clothing_item_drafts for insert
  to authenticated
  with check (user_id = (select auth.uid()));

create policy "clothing_item_drafts_update_own"
  on public.clothing_item_drafts for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "clothing_item_drafts_delete_own"
  on public.clothing_item_drafts for delete
  to authenticated
  using (user_id = (select auth.uid()));

-- -----------------------------------------
-- GRANT: anon・PUBLICには何も与えない。authenticatedは4操作だけ
-- -----------------------------------------
revoke all on table public.clothing_item_drafts from public, anon, authenticated;
grant select, insert, update, delete on table public.clothing_item_drafts to authenticated;

commit;

notify pgrst, 'reload schema';
