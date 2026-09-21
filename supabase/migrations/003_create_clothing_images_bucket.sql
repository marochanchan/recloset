-- =========================================
-- Re:closet: 服の画像用Storage基盤
-- private bucket "clothing-images" の作成と
-- storage.objects への RLS ポリシー追加
--
-- 前提とするパス構造:
--   {user_id}/{clothing_item_id}/{filename}
--
-- 注意: このファイルはまだSupabaseに実行していません。
-- clothing_items / clothing_images / wear_logs の
-- テーブル・RLS・GRANT、および既存migration(001/002)は変更していません。
-- anon ロールへの権限付与は行いません。service_role/secret keyも使いません。
-- =========================================

-- -----------------------------------------
-- 1. private bucket の作成
-- -----------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'clothing-images',
  'clothing-images',
  false,
  10485760, -- 10MB
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;

-- -----------------------------------------
-- 2. storage.objects のRLSについて
-- storage.objects は Supabase 側で最初から RLS が有効化されており、
-- テーブルの所有者は supabase_storage_admin のため、
-- SQL Editor の実行ロールからは ALTER TABLE で変更できない（不要でもある）。
-- このmigrationではRLSの有効化自体は行わず、policyの追加のみを行う。
-- -----------------------------------------

-- -----------------------------------------
-- 3. RLSポリシー: authenticatedユーザーが
--    自分のuser_idフォルダ配下のみ操作可能
-- drop policy if exists を前置し、再実行しても重複エラーにならないようにする
-- -----------------------------------------
drop policy if exists "clothing_images_select_own_folder" on storage.objects;
create policy "clothing_images_select_own_folder"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'clothing-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "clothing_images_insert_own_folder" on storage.objects;
create policy "clothing_images_insert_own_folder"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'clothing-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "clothing_images_update_own_folder" on storage.objects;
create policy "clothing_images_update_own_folder"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'clothing-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'clothing-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "clothing_images_delete_own_folder" on storage.objects;
create policy "clothing_images_delete_own_folder"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'clothing-images'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
