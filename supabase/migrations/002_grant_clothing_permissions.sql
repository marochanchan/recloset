-- =========================================
-- Re:closet: authenticatedロールへのテーブル権限付与
-- clothing_items / clothing_images / wear_logs
--
-- 背景: 001_create_clothing_schema.sql はテーブル作成・RLS有効化・
-- RLSポリシーのみを含んでおり、テーブルレベルのGRANTが含まれていなかった。
-- そのため authenticated ロールでの操作時に
-- "permission denied for table ..." が発生していた。
--
-- 注意: このファイルはまだSupabaseに実行していません。
-- 001_create_clothing_schema.sql / RLSポリシーは変更していません。
-- anon ロールへの権限付与は行いません。
-- =========================================

grant usage on schema public to authenticated;

grant select, insert, update, delete on public.clothing_items  to authenticated;
grant select, insert, update, delete on public.clothing_images to authenticated;
grant select, insert, update, delete on public.wear_logs       to authenticated;
