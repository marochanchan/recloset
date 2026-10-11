-- =========================================
-- migration 012（季節の複数選択）のロールバック用SQL
--
-- ★通常は実行しない。migrationではない（自動では適用されない）。
--
-- 優先順位:
--   1. まず「アプリだけ」を旧バージョンへ戻す（Vercel の Instant Rollback）。
--      DBは012のままでよい。season 列と season を返すRPCを残しているため、
--      旧アプリはそのまま動く（2〜3季節の服は旧アプリでは「未設定」に見える）。
--   2. DBまで戻す必要があるときだけ、このファイルを使う。
--      seasons 列を削除するため、新アプリで登録した複数季節の情報は
--      public.clothing_items から消える（下の手順0とステップ1で退避する）。
--
-- 手順:
--   0. （推奨）実行前に、SQL Editorで次を実行し、結果をCSVで保存しておく。
--        select id, season, seasons from public.clothing_items order by id;
--   1. 旧アプリへのロールバックが完了していることを確認する。
--   2. 下の「確認用の設定」の行の先頭の -- を外し、ファイル全体を1回だけ実行する。
--      （設定がないと、最初のブロックでエラーになり何も変更されない）
--   3. 012_seasons_verify.sql のブロックEで、RPCの権限が従来どおりか確認する。
--
-- 実行順序（1トランザクション）:
--   退避 → RPC 3つを drop → 旧定義（008/010/011と同じ本文）で create →
--   旧来のREVOKE/GRANT → 制約・seasons 列の削除 → commit → schema reload
--   （RPCを旧定義へ戻してから列を削除する。逆順にすると、列の削除後に
--    RPCが存在しない列を参照する時間ができるため）
-- =========================================

-- 確認用の設定（実行するときだけ、次の行の先頭の -- を外す）
-- set recloset.confirm_rollback_012 = 'yes';

begin;

-- 誤って実行した場合はここで止まる（トランザクション全体が取り消される）
do $$
begin
  if current_setting('recloset.confirm_rollback_012', true)
       is distinct from 'yes' then
    raise exception
      'rollback 012 is not confirmed. set recloset.confirm_rollback_012 = ''yes'' first.';
  end if;
end
$$;

-- -----------------------------------------
-- 1. 削除前の値を退避する（APIに公開されない migration_backup スキーマ）
-- -----------------------------------------
create schema if not exists migration_backup;
revoke all on schema migration_backup from public, anon, authenticated;

create table migration_backup.clothing_items_seasons_012_rollback as
select id, season, seasons, now() as recorded_at
from public.clothing_items;

revoke all on table migration_backup.clothing_items_seasons_012_rollback
  from public, anon, authenticated;
alter table migration_backup.clothing_items_seasons_012_rollback
  enable row level security;

-- -----------------------------------------
-- 2. RPC 3つを旧定義へ戻す（戻り値の列が違うため drop してから create）
-- -----------------------------------------
drop function public.list_public_clothing_items(integer);

-- 008 と同じ定義
create function public.list_public_clothing_items(p_limit integer default 50)
returns table (
  id uuid,
  title text,
  brand text,
  category text,
  season text,
  published_at timestamptz,
  owner_display_name text,
  cover_image_path text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    ci.id,
    ci.title,
    ci.brand,
    ci.category,
    ci.season,
    ci.published_at,
    p.display_name,
    (
      select img.image_path
      from public.clothing_images img
      where img.clothing_item_id = ci.id
      order by img.sort_order
      limit 1
    )
  from public.clothing_items ci
  left join public.profiles p on p.id = ci.user_id
  where ci.is_public
  order by ci.published_at desc, ci.id
  limit least(greatest(coalesce(p_limit, 50), 1), 100);
$$;

drop function public.get_public_clothing_item(uuid);

-- 010 と同じ定義
create function public.get_public_clothing_item(p_item_id uuid)
returns table (
  id uuid,
  title text,
  brand text,
  category text,
  season text,
  published_at timestamptz,
  owner_display_name text,
  image_paths text[],
  mercari_url text,
  rakuma_url text,
  yahoo_furima_url text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    ci.id,
    ci.title,
    ci.brand,
    ci.category,
    ci.season,
    ci.published_at,
    p.display_name,
    coalesce(
      (
        select array_agg(img.image_path order by img.sort_order)
        from public.clothing_images img
        where img.clothing_item_id = ci.id
      ),
      '{}'::text[]
    ),
    ci.mercari_url,
    ci.rakuma_url,
    ci.yahoo_furima_url
  from public.clothing_items ci
  left join public.profiles p on p.id = ci.user_id
  where ci.id = p_item_id
    and ci.is_public;
$$;

drop function public.list_my_liked_public_clothing_items();

-- 011 と同じ定義
create function public.list_my_liked_public_clothing_items()
returns table (
  id uuid,
  title text,
  brand text,
  category text,
  season text,
  published_at timestamptz,
  owner_display_name text,
  cover_image_path text,
  liked_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    ci.id,
    ci.title,
    ci.brand,
    ci.category,
    ci.season,
    ci.published_at,
    p.display_name,
    (
      select img.image_path
      from public.clothing_images img
      where img.clothing_item_id = ci.id
      order by img.sort_order
      limit 1
    ),
    l.created_at
  from public.clothing_item_likes l
  join public.clothing_items ci on ci.id = l.clothing_item_id
  left join public.profiles p on p.id = ci.user_id
  where l.user_id = (select auth.uid())
    and ci.is_public
  order by l.created_at desc, ci.id
  limit 100;
$$;

-- -----------------------------------------
-- 3. 旧来のREVOKE/GRANT（008・010・011と同じ）
-- -----------------------------------------
revoke all on function public.list_public_clothing_items(integer) from public;
revoke all on function public.get_public_clothing_item(uuid) from public;
grant execute on function public.list_public_clothing_items(integer) to anon, authenticated;
grant execute on function public.get_public_clothing_item(uuid) to anon, authenticated;

revoke all on function public.list_my_liked_public_clothing_items() from public, anon;
grant execute on function public.list_my_liked_public_clothing_items() to authenticated;

-- -----------------------------------------
-- 4. seasons 列を削除する（RPCが参照しなくなった後）
-- -----------------------------------------
alter table public.clothing_items drop constraint clothing_items_seasons_values;
alter table public.clothing_items drop column seasons;

commit;

notify pgrst, 'reload schema';

-- 退避した値（migration_backup.clothing_items_seasons_012_rollback）と
-- 適用時点のスナップショット（migration_backup.clothing_items_seasons_012）は、
-- 状況を確認し終えるまで残す。
