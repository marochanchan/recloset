-- =========================================
-- Re:Closet: 外部フリマサービスの出品URL
-- clothing_items.mercari_url / rakuma_url / yahoo_furima_url、
-- 公開服詳細RPC（get_public_clothing_item）への3列追加
--
-- 背景: ユーザーが既存のフリマサービスに出品している服について、
-- 出品ページのURLを手動で登録し、Re:Closet Loopで公開した服の
-- 詳細ページから外部サービスへ移動できるようにする。
-- 売買・決済・配送・API連携・スクレイピング・状態同期は行わない。
--
-- 方針:
-- - 対応は卒制版の3サービスのみ。新しいテーブルは作らず、
--   clothing_itemsへのカラム追加にとどめる。
-- - 列追加のため、既存のRLS（001: owner-only）とauthenticatedへの
--   テーブル単位GRANT（002）がそのまま適用され、本人だけが自分の服の
--   URLを登録・変更できる。anonへのテーブルGRANTは追加しない。
-- - フォームはブラウザから直接clothing_itemsへ書き込むため、
--   URLの形式はこのCHECK制約で強制する（アプリ側の検証は
--   lib/marketplace-urls.ts。許可範囲は両方で揃える）。
-- - 公開側は、公開服詳細RPCが返す列に3列を追加する（意図的に公開する）。
--   一覧RPC（list_public_clothing_items）は変更しない。
-- - status（sold等）とは連動させない。URLはユーザーが編集画面で削除する。
--
-- 注意: このファイルはまだSupabaseに実行していません。
-- 既存migration (001-009) は変更していません。
-- =========================================

begin;

-- -----------------------------------------
-- 1. カラム追加（既存行はnull = 未登録）
-- -----------------------------------------
alter table public.clothing_items
  add column mercari_url text,
  add column rakuma_url text,
  add column yahoo_furima_url text;

comment on column public.clothing_items.mercari_url is
  'メルカリの出品ページURL（本人が手動登録・任意）。公開中はget_public_clothing_itemで公開される。';
comment on column public.clothing_items.rakuma_url is
  'ラクマの出品ページURL（本人が手動登録・任意）。公開中はget_public_clothing_itemで公開される。';
comment on column public.clothing_items.yahoo_furima_url is
  'Yahoo!フリマの出品ページURL（本人が手動登録・任意）。公開中はget_public_clothing_itemで公開される。';

-- -----------------------------------------
-- 2. CHECK制約
-- アプリ側で正規化した「https://{hostname}{商品path}」の形だけを許可する。
-- 先頭から末尾まで固定のhostnameと商品pathで完全一致させるため、
-- 次のような偽装・別ドメインは通らない:
--   http://...（https以外）、https://jp.mercari.com.evil.example/...、
--   https://jp.mercari.com@evil.example/...（username）、
--   https://user:pass@jp.mercari.com/...、https://jp.mercari.com:8443/...（port）、
--   クエリ・ハッシュ付き、短縮URL・共有用ドメイン、javascript: 等
-- -----------------------------------------
alter table public.clothing_items
  add constraint clothing_items_mercari_url_format
  check (
    mercari_url is null
    or (
      char_length(mercari_url) <= 500
      and mercari_url ~ '^https://jp\.mercari\.com/item/[A-Za-z0-9]+$'
    )
  );

alter table public.clothing_items
  add constraint clothing_items_rakuma_url_format
  check (
    rakuma_url is null
    or (
      char_length(rakuma_url) <= 500
      and rakuma_url ~ '^https://item\.fril\.jp/[0-9a-f]{32}$'
    )
  );

alter table public.clothing_items
  add constraint clothing_items_yahoo_furima_url_format
  check (
    yahoo_furima_url is null
    or (
      char_length(yahoo_furima_url) <= 500
      and yahoo_furima_url ~ '^https://paypayfleamarket\.yahoo\.co\.jp/item/[A-Za-z0-9]+$'
    )
  );

-- -----------------------------------------
-- 3. 公開服詳細RPCに出品URL3列を追加
-- 戻り値の列が変わるためcreate or replaceは使えず、drop → createで
-- 作り直す。それ以外（security definer・search_path=''・is_public条件・
-- 既存の戻り値列）は008と同じ。非公開・存在しないidは0行のまま。
-- -----------------------------------------
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

-- -----------------------------------------
-- 4. RPCの権限を再設定（dropで008のGRANTも消えるため）
-- -----------------------------------------
revoke all on function public.get_public_clothing_item(uuid) from public;
grant execute on function public.get_public_clothing_item(uuid) to anon, authenticated;

commit;
