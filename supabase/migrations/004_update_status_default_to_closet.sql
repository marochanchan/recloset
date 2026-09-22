-- =========================================
-- Re:closet: clothing_items.status のデフォルト値変更
-- 'active' -> 'closet'
--
-- 背景: Next.js版では当初 status の default を 'active' としていたが、
-- 「クローゼット / 手放し候補 / 手放す / 売却済み」という
-- closet / candidate / letting_go / sold の4状態で管理する方針に
-- 変更したため、defaultおよび既存データを 'closet' に合わせる。
--
-- 注意: このファイルはまだSupabaseに実行していません。
-- 001_create_clothing_schema.sql は変更していません。
-- CHECK制約・ENUM化は行わず、statusはtext型のまま維持します。
-- =========================================

-- -----------------------------------------
-- 1. 既存データの移行
-- status = 'active' の行だけを 'closet' へ更新する。
-- 条件で絞っているため、何度実行しても安全（冪等）。
-- -----------------------------------------
update public.clothing_items
set status = 'closet'
where status = 'active';

-- -----------------------------------------
-- 2. デフォルト値の変更
-- 今後の新規登録で使われるdefaultを 'closet' に変更する。
-- -----------------------------------------
alter table public.clothing_items
  alter column status set default 'closet';
