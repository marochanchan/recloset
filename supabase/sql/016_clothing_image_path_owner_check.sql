-- =========================================
-- 016 適用前の確認用（読み取り専用。データは一切変更しない）
--
-- clothing_images.image_path の先頭フォルダが、その画像行の服の所有者
-- （clothing_items.user_id）と一致しない行を探す。
-- migration 016 の判定（public.is_clothing_image_path_owned_by）と同じ条件を
-- ここでは関数を使わずに書いている（016の適用前でも実行できるようにするため）。
--
-- 使い方: SQL Editorで、クエリを1つずつ選択して実行する。
-- 不整合な行が見つかっても、ここでは修正・削除しない。
--
-- 結果の扱い:
-- - クエリ1の mismatched_rows が 0 なら、016を適用しても既存の画像表示・
--   編集に影響はない。
-- - 1件以上ある場合は、クエリ2で内容を確認してから対応を決める。
--   016の適用後、その行の画像は公開扱いにならず、所有者が並び替え等で
--   その行をUPDATEしようとするとRLSで拒否される（表示・削除はできる）。
-- =========================================

-- -----------------------------------------
-- クエリ1: 件数のまとめ（1行）
-- -----------------------------------------
with checked as (
  select
    img.id,
    ci.is_public,
    coalesce(
      cardinality(s.segments) >= 2
        and s.segments[1] = ci.user_id::text
        and '' <> all (s.segments)
        and not (s.segments && array['.', '..']),
      false
    ) as owned
  from public.clothing_images img
  join public.clothing_items ci on ci.id = img.clothing_item_id
  cross join lateral (
    select string_to_array(img.image_path, '/') as segments
  ) as s
)
select
  count(*) as total_rows,
  count(*) filter (where not owned) as mismatched_rows,
  count(*) filter (where not owned and is_public) as mismatched_rows_on_public_items
from checked;

-- -----------------------------------------
-- クエリ2: 不整合な行の詳細（0行なら問題なし）
--
-- path_owner_is_other_user: 先頭フォルダが別の実在ユーザーのID
--   （true なら、他人の画像を参照している可能性が高い）
-- storage_object_exists: そのパスのファイルがStorageに実在するか
-- -----------------------------------------
select
  img.id as image_id,
  img.clothing_item_id,
  ci.user_id as item_owner_id,
  split_part(img.image_path, '/', 1) as path_first_folder,
  img.image_path,
  ci.is_public,
  exists (
    select 1 from auth.users u
    where u.id::text = split_part(img.image_path, '/', 1)
      and u.id <> ci.user_id
  ) as path_owner_is_other_user,
  exists (
    select 1 from storage.objects o
    where o.bucket_id = 'clothing-images'
      and o.name = img.image_path
  ) as storage_object_exists
from public.clothing_images img
join public.clothing_items ci on ci.id = img.clothing_item_id
cross join lateral (
  select string_to_array(img.image_path, '/') as segments
) as s
where not coalesce(
  cardinality(s.segments) >= 2
    and s.segments[1] = ci.user_id::text
    and '' <> all (s.segments)
    and not (s.segments && array['.', '..']),
  false
)
order by ci.is_public desc, img.clothing_item_id, img.sort_order;

-- -----------------------------------------
-- クエリ3: 同じパスが複数の所有者の服に登録されていないか（0行なら問題なし）
-- -----------------------------------------
select
  img.image_path,
  count(distinct ci.user_id) as owner_count,
  array_agg(distinct ci.id) as clothing_item_ids
from public.clothing_images img
join public.clothing_items ci on ci.id = img.clothing_item_id
group by img.image_path
having count(distinct ci.user_id) > 1;

-- -----------------------------------------
-- クエリ4（参考）: パスの2番目のフォルダが服のIDと異なる行の件数
--
-- 016では強制しない（同じ所有者の別の服のフォルダを指していても
-- 他人の画像にはならないため）。アプリは常に {user_id}/{服のID}/... で
-- 保存しているので、通常は0件。0件でなくても016の適用には影響しない。
-- -----------------------------------------
select count(*) as rows_with_other_item_folder
from public.clothing_images img
where split_part(img.image_path, '/', 2) <> img.clothing_item_id::text;

-- -----------------------------------------
-- クエリ5（参考）: 下書きの image_paths に本人のフォルダ以外のパスがないか
--
-- 下書きの写真は本人のセッションでしか署名せず、Storageの本人用ポリシー
-- （003）とアプリ側の確認で他人のパスは署名されないため、016の対象外。
-- 不正な値が入っていないかの確認用（通常は0件）。
-- -----------------------------------------
select d.id as draft_id, d.user_id, p.path
from public.clothing_item_drafts d
cross join lateral unnest(d.image_paths) as p(path)
where split_part(p.path, '/', 1) <> d.user_id::text;
