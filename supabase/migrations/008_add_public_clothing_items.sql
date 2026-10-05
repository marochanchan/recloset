-- =========================================
-- Re:closet: 公開服機能の基盤
-- clothing_items.is_public / published_at、公開データ取得用RPC、
-- 公開服画像のStorage SELECTポリシー
--
-- 背景: ユーザーが明示的に「公開する」を選んだ服だけを、未ログイン
-- ユーザー（anon）も含めて閲覧できるようにする（公開服Phaseの基盤）。
--
-- 方針:
-- - clothing_items / clothing_images / profiles の既存RLS・GRANTは一切
--   変更しない（「自分のクローゼットは本人だけ」のowner-onlyを維持）。
-- - clothing_itemsに公開SELECTポリシーを追加する方式は採らない。
--   RLSは行単位でしか制御できず、authenticatedはテーブル全体への
--   SELECT権限（002）を持つため、ポリシーを足すとログイン中の他ユーザーが
--   Data API経由で公開服のpurchase_price/favorite/user_id等まで
--   読めてしまうため。
-- - 公開データは、安全な列だけを返すsecurity definer関数経由でのみ
--   取得させる。anonへのテーブルGRANTは行わない。
-- - 所有者のdisplay_nameは関数内でprofilesをJOINして返すため、
--   anonへprofilesのGRANT/ポリシーは追加しない。
-- - statusと公開状態は完全に独立。statusの変更で公開状態は変わらない。
--
-- 以下は今回のスコープ外: 公開コメント・conversations/messages・DM・
-- Realtime・フリマアプリ管理・通知・avatar・表示名変更UI。
--
-- 注意: このファイルはまだSupabaseに実行していません。
-- 既存migration (001-007) は変更していません。
-- =========================================

-- -----------------------------------------
-- 1. カラム追加
-- 既存行は is_public = false / published_at = null となり、
-- 2.のCHECK制約を満たす（適用直後に公開される服は0件）。
-- -----------------------------------------
alter table public.clothing_items
  add column is_public boolean not null default false,
  add column published_at timestamptz;

comment on column public.clothing_items.is_public is
  '所有者本人が明示的に公開した場合のみtrue。statusとは完全に独立し、
   statusの変更（candidate/letting_go等）で自動的に変わることはない。';
comment on column public.clothing_items.published_at is
  '直近に公開した日時。非公開に戻すとnullに戻す（2.のCHECK制約で
   is_publicとの整合性を保証）。再公開時は新しい日時が入る。';

-- -----------------------------------------
-- 2. CHECK制約
-- 「公開中なのにpublished_atがない」「非公開なのにpublished_atがある」
-- といった矛盾した状態をDBレベルで防ぐ。
-- -----------------------------------------
alter table public.clothing_items
  add constraint clothing_items_publication_consistency
  check (
    (is_public and published_at is not null)
    or (not is_public and published_at is null)
  );

-- -----------------------------------------
-- 3. インデックス
-- -----------------------------------------

-- 公開服一覧（is_publicのみ、新しい順）用の部分インデックス
create index idx_clothing_items_public_published_at
  on public.clothing_items (published_at desc)
  where is_public;

-- Storageポリシー（6.）から毎回image_pathの完全一致で引くため
create index idx_clothing_images_image_path
  on public.clothing_images (image_path);

-- -----------------------------------------
-- 4. 公開データ取得用RPC
--
-- security definer: 呼び出し元（anon/authenticated）の権限ではRLSにより
-- 他人の服を参照できないため、関数所有者の権限で実行する。その代わり、
-- 返す列を公開してよい情報（title/brand/category/season/published_at/
-- 所有者display_name/画像パス）だけに限定し、where ci.is_public で
-- 公開服だけに絞る。user_id・購入情報・着用情報・status・AI診断は返さない。
--
-- 関数所有者: SQL Editorで実行するため postgres になる。postgres は
-- clothing_items / clothing_images / profiles のテーブル所有者でもあり、
-- これらのテーブルは FORCE ROW LEVEL SECURITY を設定していないため、
-- 関数内の参照にはRLSが適用されない（＝関数のwhere句と戻り値の列だけが
-- 公開範囲を決める。ここを広げると即座に漏えいになる点に注意）。
--
-- search_path = '' で固定し、参照はすべてschema修飾する
-- （security definer関数における一般的なセキュリティ上の注意点への対応）。
--
-- 注意: image_path は "{user_id}/{clothing_item_id}/{uuid}.{ext}" 形式の
-- ため、user_id列そのものは返さないが、画像パス文字列の中には含まれる。
-- 署名付きURL生成にパスが必要なため、パス設計を変えない限り避けられない
-- （user_idはメールアドレス等の個人情報ではなく、display_nameで同一人物と
-- 分かる以上の情報は増えない）。
-- -----------------------------------------

-- 4-a. 公開服一覧（代表画像は sort_order が最小の1枚）。
-- p_limitは1〜100に丸める（全件を一度に取得させない）。
create or replace function public.list_public_clothing_items(p_limit integer default 50)
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

-- 4-b. 公開服詳細。非公開の服・存在しないidはどちらも0行を返す
-- （「存在するが非公開」かどうかを外部から判別できないようにする）。
create or replace function public.get_public_clothing_item(p_item_id uuid)
returns table (
  id uuid,
  title text,
  brand text,
  category text,
  season text,
  published_at timestamptz,
  owner_display_name text,
  image_paths text[]
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
    )
  from public.clothing_items ci
  left join public.profiles p on p.id = ci.user_id
  where ci.id = p_item_id
    and ci.is_public;
$$;

-- -----------------------------------------
-- 5. Storageポリシー用の判定関数
--
-- object名が「公開服に登録済みの画像」である場合だけtrueを返す。
-- storage.foldername(name) によるpath解析や ::uuid キャストは行わず、
-- clothing_images.image_path との完全一致で判定する。理由:
-- - アップロードpathはクライアント側で組み立てており、Storageの
--   INSERTポリシー（003）は先頭フォルダ = auth.uid() しか検証しない。
--   path上のclothing_item_idだけで判定すると、DB未登録の孤立ファイルや
--   他人の公開item_idを名乗るファイルまで公開対象になりうる。
-- - 不正なpathに対する ::uuid キャストはポリシー評価中に例外となり、
--   リクエスト全体を失敗させるリスクがある。
-- user_idとclothing_item_idの対応は clothing_images → clothing_items の
-- 外部キーによりDB側で保証される。
--
-- Storage RLSから呼ぶためanon/authenticatedにEXECUTEが必要で、その結果
-- RPCとしても直接呼べるが、戻り値はbooleanのみ。trueになるのは公開服の
-- 画像パス（＝4.のRPCで既に誰でも取得できるパス）だけで、非公開画像の
-- ファイル名はランダムなUUIDのため、パスを推測して存在確認することも
-- 現実的にできない（非公開・未登録・存在しないパスはすべて同じfalse）。
-- -----------------------------------------
create or replace function public.is_public_clothing_image(p_object_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.clothing_images img
    join public.clothing_items ci on ci.id = img.clothing_item_id
    where img.image_path = p_object_name
      and ci.is_public
  );
$$;

-- -----------------------------------------
-- 6. Storage RLSポリシー: 公開服の画像だけanon/authenticatedがSELECT可能
--
-- bucketはprivateのまま維持する（public bucketにすると非公開画像も
-- パスさえ分かれば読めてしまうため）。サーバー側でcreateSignedUrlsを
-- 呼ぶにはSELECT権限が必要なため、このポリシーで公開服の画像に限って
-- 付与する。既存のowner用ポリシー（003）とはORで合成されるため、
-- 本人の挙動は変わらない。anonにはSELECTのみで、insert/update/deleteの
-- ポリシーは追加しない。
-- -----------------------------------------
drop policy if exists "clothing_images_select_public_item" on storage.objects;
create policy "clothing_images_select_public_item"
  on storage.objects for select
  to anon, authenticated
  using (
    bucket_id = 'clothing-images'
    and public.is_public_clothing_image(name)
  );

-- -----------------------------------------
-- 7. GRANT
-- 2026/10/30以降のSupabase Data API変更に備え、新規の権限を明示する。
--
-- - anonがRPCを呼ぶためにschema publicのusageを付与する
--   （authenticatedへは002で付与済み）。
-- - Postgresは関数作成時にPUBLICへEXECUTEを付与するため、一度revokeした
--   うえで、必要なロール（anon/authenticated）にだけ明示的に付与する。
-- - clothing_items / clothing_images / profiles へのテーブルGRANTは
--   anonに一切付与しない。001〜007でもanonへのテーブルGRANTはないため、
--   anonがベーステーブルを直接SELECTすると permission denied になり、
--   公開データは4.のRPCからのみ取得できる（仮にSupabaseのデフォルト
--   権限でanonに付与されていても、owner-only RLSにより0件になる）。
-- - 追加カラム（is_public/published_at）は002のauthenticatedへの
--   テーブル単位GRANTに含まれ、本人は既存のclothing_items_update_own
--   ポリシーの範囲で更新できる。
-- -----------------------------------------
grant usage on schema public to anon;

revoke all on function public.list_public_clothing_items(integer) from public;
revoke all on function public.get_public_clothing_item(uuid) from public;
revoke all on function public.is_public_clothing_image(text) from public;

grant execute on function public.list_public_clothing_items(integer) to anon, authenticated;
grant execute on function public.get_public_clothing_item(uuid) to anon, authenticated;
grant execute on function public.is_public_clothing_image(text) to anon, authenticated;

-- -----------------------------------------
-- 注意: このファイル全体の再実行について
-- 1.の add column、2.の add constraint、3.の create index には
-- if not exists を付けていないため、このファイルを最初から再実行すると
-- それらの時点でエラーになる。4.・5.（create or replace）、6.（drop policy
-- if exists + create）、7.（grant/revoke）は単独では再実行に強い書き方に
-- しているが、ファイル全体としての再実行を安全に行える設計ではない。
-- 再実行が必要な場合は、1.〜3.を除くブロックだけを個別に実行すること。
-- -----------------------------------------
