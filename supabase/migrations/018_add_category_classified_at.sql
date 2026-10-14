-- =========================================
-- Re:Closet: カテゴリを分類した日時（clothing_items.category_classified_at）
--
-- 背景: クイック仕分け（/protected/items/classify）は、写真だけ登録したままの服
-- （title='写真から登録した服' かつ category='other'）をカテゴリ未分類として扱う。
-- 仕分けで「その他」を選んでも値が変わらないため、次回も未分類として表示されていた。
-- 「カテゴリを分類した」ことを記録する列を追加して区別する。
--
-- 方針:
-- - 列を1つ追加するだけ。null 可（未記録）。既存の行は null のまま
--   （既存データは一括更新しない）。
-- - アプリが値を書くのは次の2か所だけ（DBトリガーは使わない）:
--   1. クイック仕分けでカテゴリを選んで保存したとき（「その他」を選んだ場合も含む）
--   2. 通常の編集画面でカテゴリを変更して保存したとき
-- - カテゴリ未分類の判定（lib/clothing-classify.ts）:
--   title='写真から登録した服' かつ category='other' かつ category_classified_at is null。
--   従来の条件を残したまま絞り込むため、これまで未分類でなかった服が
--   未分類になることはない。
-- - 列追加のため、既存のRLS（001: owner-only）とauthenticatedへの
--   テーブル単位GRANT（002）がそのまま適用される。anonへのGRANTは追加しない。
-- - 公開RPC（008・010・011・012）は戻り値の列を明示しているため、
--   この列は公開されない。RPCは変更しない。
--
-- 適用: Supabase SQL Editor で、このファイル全体を1回だけ実行する。
-- 注意: このファイルはまだSupabaseに実行していません。
-- この列を読み書きするアプリより先に適用すること（未適用だとクイック仕分けの
-- 読み込み・保存と、編集画面でカテゴリを変えたときの保存が失敗する）。
-- 既存migration (001-017) は変更していません。
-- =========================================

begin;

alter table public.clothing_items
  add column category_classified_at timestamptz;

comment on column public.clothing_items.category_classified_at is
  'カテゴリを分類した日時（クイック仕分けで保存・編集画面でカテゴリを変更したとき）。nullは未記録';

commit;

notify pgrst, 'reload schema';
