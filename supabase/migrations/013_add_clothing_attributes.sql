-- =========================================
-- Re:Closet: 服の種類・メインカラー（clothing_items.subcategory / main_color）
--
-- 背景: 写真のAI解析（Gemini）は1回の解析で種類・メインカラーも返している。
-- 登録時に自動入力して保存し、将来のコーデ提案などで使えるようにする。
--
-- 方針:
-- - 列を2つ追加するだけ。どちらも null 可（未設定）。既存の行は null のまま。
-- - 値の選択肢とカテゴリーとの組み合わせは、category と同じくアプリ側で
--   検証する（lib/clothing-options.ts）。CHECK制約は付けない。
-- - 列追加のため、既存のRLS（001: owner-only）とauthenticatedへの
--   テーブル単位GRANT（002）がそのまま適用される。anonへのGRANTは追加しない。
-- - 既存データ・season/seasons・公開RPCは変更しない（Loopには出さない）。
--
-- 適用: Supabase SQL Editor で、このファイル全体を1回だけ実行する。
-- 注意: このファイルはまだSupabaseに実行していません。
-- 既存migration (001-012) は変更していません。
-- =========================================

begin;

alter table public.clothing_items
  add column subcategory text,
  add column main_color text;

comment on column public.clothing_items.subcategory is
  '服の種類（tshirt/shirt_blouse/knit/…）。categoryに属する値だけをアプリ側で保存する。nullは未設定';
comment on column public.clothing_items.main_color is
  'メインカラー（white/black/gray/…/multi/other）。値はアプリ側で検証する。nullは未設定';

commit;

notify pgrst, 'reload schema';
