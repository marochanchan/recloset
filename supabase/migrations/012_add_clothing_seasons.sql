-- =========================================
-- Re:Closet: 季節の複数選択（clothing_items.seasons）
--
-- 背景: 1着につき1つしか選べない season（spring/summer/autumn/winter/all）
-- では、春・夏・秋に着られるブラウスのような服を表せない。
-- 春・夏・秋・冬の複数選択（text[]）へ移行する。
--
-- 方針:
-- - 新しい列 seasons text[] を追加する。未設定は空配列、
--   オールシーズンは4季節すべて。並び順は春→夏→秋→冬（アプリ側で正規化）。
-- - 既存の season 列は変更・削除しない（互換用・ロールバック用）。
--   新アプリは保存のたびに seasons から season を導いて書く
--   （4季節→'all'、1季節→その値、0季節→null、2〜3季節→null）。
-- - 既存データは season から seasons へ移す（season 自体は書き換えない）。
--   移行前の確認結果（2026-10）: all 8 / summer 7 / autumn 5 / spring 2 /
--   winter 1 / null 1 / 想定外の値 0。
-- - 列追加のため、既存のRLS（001: owner-only）とauthenticatedへの
--   テーブル単位GRANT（002）がそのまま適用される。anonへのGRANTは追加しない。
-- - 公開RPC 3つは、戻り値の列が変わるため drop → create する。
--   移行期間中は旧アプリのため season も返し続け、seasons は最後の列に追加する
--   （supabase.rpc() は列名で受け取るため、列の追加・順序は旧アプリに影響しない）。
--   本文（公開条件・JOIN）、security definer、search_path、GRANTは従来と同じ。
--
-- - 適用時点の季節を migration_backup スキーマに記録する（照合用）。
--   API（PostgREST）に公開されないスキーマで、anon/authenticated には
--   権限を与えない。新旧アプリ混在期間の不整合を確認するときに、
--   このスナップショットと照合して個別に判断する（一括修正はしない）。
--   後片付けのmigrationで削除する。
--
-- 適用: Supabase SQL Editor で、このファイル全体を1回だけ実行する。
-- 注意: このファイルはまだSupabaseに実行していません。
-- 既存migration (001-011) は変更していません。
-- =========================================

begin;

-- -----------------------------------------
-- 1. 列の追加（既存の行は空配列になる）
-- -----------------------------------------
alter table public.clothing_items
  add column seasons text[] not null default '{}'::text[];

alter table public.clothing_items
  add constraint clothing_items_seasons_values
  check (seasons <@ array['spring', 'summer', 'autumn', 'winter']::text[]);

comment on column public.clothing_items.seasons is
  '着られる季節（spring/summer/autumn/winterの複数選択）。空配列は未設定、4つすべてはオールシーズン。旧season列は互換用に残している';

-- -----------------------------------------
-- 2. 既存データの移行（season は書き換えない）
-- -----------------------------------------
update public.clothing_items
set seasons = case
  when season = 'all' then array['spring', 'summer', 'autumn', 'winter']::text[]
  when season in ('spring', 'summer', 'autumn', 'winter') then array[season]::text[]
  else '{}'::text[]
end;

-- -----------------------------------------
-- 2-b. 適用時点の記録（照合用のスナップショット）
--      season / seasons / 登録日時を、適用した時点の値のまま保存する
-- -----------------------------------------
create schema if not exists migration_backup;
revoke all on schema migration_backup from public, anon, authenticated;

create table migration_backup.clothing_items_seasons_012 (
  id uuid primary key,
  season text,
  seasons text[] not null,
  item_created_at timestamptz not null,
  recorded_at timestamptz not null default now()
);

revoke all on table migration_backup.clothing_items_seasons_012
  from public, anon, authenticated;
alter table migration_backup.clothing_items_seasons_012
  enable row level security;

insert into migration_backup.clothing_items_seasons_012
  (id, season, seasons, item_created_at)
select id, season, seasons, created_at
from public.clothing_items;

-- -----------------------------------------
-- 3. 公開RPC: seasons を最後の列として追加（season も引き続き返す）
-- -----------------------------------------

-- 3-a. 公開服一覧（008と同じ本文）
drop function public.list_public_clothing_items(integer);

create function public.list_public_clothing_items(p_limit integer default 50)
returns table (
  id uuid,
  title text,
  brand text,
  category text,
  season text,
  published_at timestamptz,
  owner_display_name text,
  cover_image_path text,
  seasons text[]
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
    ci.seasons
  from public.clothing_items ci
  left join public.profiles p on p.id = ci.user_id
  where ci.is_public
  order by ci.published_at desc, ci.id
  limit least(greatest(coalesce(p_limit, 50), 1), 100);
$$;

-- 3-b. 公開服詳細（010と同じ本文）
drop function public.get_public_clothing_item(uuid);

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
  yahoo_furima_url text,
  seasons text[]
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
    ci.yahoo_furima_url,
    ci.seasons
  from public.clothing_items ci
  left join public.profiles p on p.id = ci.user_id
  where ci.id = p_item_id
    and ci.is_public;
$$;

-- 3-c. 本人の「気になる」のうち公開中の服（011と同じ本文）
drop function public.list_my_liked_public_clothing_items();

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
  liked_at timestamptz,
  seasons text[]
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
    l.created_at,
    ci.seasons
  from public.clothing_item_likes l
  join public.clothing_items ci on ci.id = l.clothing_item_id
  left join public.profiles p on p.id = ci.user_id
  where l.user_id = (select auth.uid())
    and ci.is_public
  order by l.created_at desc, ci.id
  limit 100;
$$;

-- -----------------------------------------
-- 4. RPCの権限を従来どおりに再設定（dropでGRANTも消えるため）
-- - 公開一覧・詳細: 未ログイン（anon）も呼べる（008・010と同じ）
-- - 気になる服一覧: ログインユーザーだけ（011と同じ。anonからも取り消す）
-- -----------------------------------------
revoke all on function public.list_public_clothing_items(integer) from public;
revoke all on function public.get_public_clothing_item(uuid) from public;
grant execute on function public.list_public_clothing_items(integer) to anon, authenticated;
grant execute on function public.get_public_clothing_item(uuid) to anon, authenticated;

revoke all on function public.list_my_liked_public_clothing_items() from public, anon;
grant execute on function public.list_my_liked_public_clothing_items() to authenticated;

commit;

-- -----------------------------------------
-- 5. PostgREST（Supabase API）に関数定義を読み直させる
--    （作り直した直後に「関数が見つからない」とならないようにする）
-- -----------------------------------------
notify pgrst, 'reload schema';

-- -----------------------------------------
-- 注意: このファイル全体の再実行について
-- 1.の add column / add constraint、2-b.の create table には
-- if not exists を付けていないため、再実行すると1.でエラーになり、
-- トランザクション全体が取り消される（データは変わらない）。
-- 途中のどの文で失敗しても同様に全体が取り消され、season 列・既存の
-- 公開RPC・権限は適用前のまま残る。適用済みかどうかは
-- supabase/sql/012_seasons_verify.sql のブロックBで判断する。
-- -----------------------------------------
