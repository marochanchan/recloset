-- =========================================
-- Re:closet: 服画像のパスと服の所有者の整合性を強制する
--
-- 背景（修正する問題）:
-- - clothing_images の INSERT/UPDATE ポリシー（001）は「自分の服の行か」
--   だけを検証し、image_path の中身は検証していなかった。
-- - 公開判定 is_public_clothing_image（008）は「公開中の服に、その
--   image_path の行があるか」だけを見ており、パスが服の所有者の
--   フォルダにあるかを確認していなかった。
-- - そのため、他人の画像パス（一度公開された服のパスは公開RPCで見える）を
--   自分の公開中の服に登録すると、Storageの公開ポリシー（008）により
--   その画像を誰でも署名・閲覧できる状態にできた（公開解除後も含む）。
--
-- 対応:
-- 1. パスが所有者のフォルダ（{user_id}/...）にあるかを判定する関数を追加
--    （Storageの本人用ポリシー（003）と同じく先頭フォルダで所有者を判定）
-- 2. clothing_images の INSERT/UPDATE ポリシーで、パスの先頭フォルダが
--    服の所有者であることを必須にする（UPDATEによる付け替えも防ぐ）
-- 3. is_public_clothing_image でも同じ整合性を確認する。既に不整合な行が
--    あっても、その画像は公開扱いにならない（＝新たに署名できない）
--
-- 変更しないもの:
-- - Storage（storage.objects）のポリシー: 本人用（003）は先頭フォルダ =
--   auth.uid() で正しく、公開用（008）は判定関数の修正だけで直るため
-- - 公開RPC（list_public_clothing_items 等）: 不整合な行のパスを返しても、
--   3.により署名できないため画像は表示されない
-- - clothing_images の SELECT/DELETE ポリシー、テーブルのGRANT
-- - 既存データ（不整合な行があっても自動修正・削除はしない。
--   supabase/sql/016_clothing_image_path_owner_check.sql で事前に確認する）
--
-- 前提: 001, 002, 003, 008 が適用済みであること。
-- 再実行しても同じ結果になる（create or replace / drop policy if exists）。
-- service_role・secret keyは使わない。
--
-- 適用状況: 2026-10-13 に本番Supabaseへ適用済み（適用前の整合性確認で
-- 不一致0件、適用後に所有者チェック・INSERT/UPDATEポリシーを確認済み）。
-- =========================================

begin;

-- -----------------------------------------
-- 1. パスの所有者判定
--
-- パスを "/" で区切ったセグメントの配列にして、次をすべて満たすときだけtrue:
-- - セグメントが2つ以上ある（ユーザーIDのフォルダの下にファイル名がある）
-- - 先頭のセグメントが p_user_id と完全一致する（uuid::text は小文字の
--   正規形で、アプリが組み立てるパス・Storageポリシー（003）の比較と同じ表現）
-- - 空のセグメントがない（空パス・先頭や末尾の "/"・"//" を拒否する。
--   最後のセグメント＝ファイル名が空でないこともここで保証される）
-- - "." / ".." のセグメントがない（パスの見かけと実体がずれる余地を残さない）
-- p_image_path・p_user_id が NULL の場合は false（NULLは返さない）。
--
-- 入力だけで決まる純粋な関数のため immutable。security definer にはしない
-- （呼び出し元の権限で動けばよく、テーブルも参照しない）。
-- -----------------------------------------
create or replace function public.is_clothing_image_path_owned_by(
  p_image_path text,
  p_user_id uuid
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    cardinality(s.segments) >= 2
      and s.segments[1] = p_user_id::text
      and '' <> all (s.segments)
      and not (s.segments && array['.', '..']),
    false
  )
  from (select string_to_array(p_image_path, '/') as segments) as s;
$$;

-- -----------------------------------------
-- 2. clothing_images の INSERT/UPDATE ポリシー
--
-- 001と同じポリシー名・同じ対象ロール（指定なし）のまま、条件に
-- パスの所有者判定を加える。UPDATEは using（更新前の行が自分の服の行）は
-- 従来どおりで、with check（更新後の行）にパスの判定を加えるため、
-- image_path や clothing_item_id を書き換えて他人のパスを指すことはできない。
-- アプリのUPDATEは sort_order だけで、パスは変わらないため影響しない。
-- -----------------------------------------
drop policy if exists "clothing_images_insert_own" on public.clothing_images;
create policy "clothing_images_insert_own"
  on public.clothing_images for insert
  with check (
    exists (
      select 1 from public.clothing_items ci
      where ci.id = clothing_images.clothing_item_id
        and ci.user_id = (select auth.uid())
        and public.is_clothing_image_path_owned_by(
          clothing_images.image_path,
          ci.user_id
        )
    )
  );

drop policy if exists "clothing_images_update_own" on public.clothing_images;
create policy "clothing_images_update_own"
  on public.clothing_images for update
  using (
    exists (
      select 1 from public.clothing_items ci
      where ci.id = clothing_images.clothing_item_id
        and ci.user_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.clothing_items ci
      where ci.id = clothing_images.clothing_item_id
        and ci.user_id = (select auth.uid())
        and public.is_clothing_image_path_owned_by(
          clothing_images.image_path,
          ci.user_id
        )
    )
  );

-- -----------------------------------------
-- 3. 公開判定関数（008）の修正
--
-- 戻り値・引数・security definer・search_path・stable は008と同じ。
-- 条件に「画像パスが服の所有者のフォルダにある」を加える。
-- security definer のため、関数内の参照と所有者判定関数の実行は
-- 関数所有者（postgres）の権限で行われる（呼び出し元に追加の権限は不要）。
-- 返すのはbooleanのみで、trueになるのは「公開中の服に、所有者本人の
-- フォルダの画像として登録されたパス」だけ。
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
      and public.is_clothing_image_path_owned_by(img.image_path, ci.user_id)
  );
$$;

-- -----------------------------------------
-- 4. GRANT
--
-- - is_clothing_image_path_owned_by: clothing_images のRLSポリシーは
--   呼び出し元の権限で評価されるため、authenticatedにEXECUTEが必要。
--   anonはclothing_imagesへのテーブル権限がなく不要のため付与しない
--   （Supabaseの既定権限でanonに直接付与される場合があるため、
--   PUBLIC・anonの両方からrevokeする。011と同じ方針）。
-- - is_public_clothing_image: create or replace は既存の権限を保つが、
--   008と同じ状態であることをここでも明示する。
-- -----------------------------------------
revoke all on function public.is_clothing_image_path_owned_by(text, uuid) from public, anon;
grant execute on function public.is_clothing_image_path_owned_by(text, uuid) to authenticated;

revoke all on function public.is_public_clothing_image(text) from public;
grant execute on function public.is_public_clothing_image(text) to anon, authenticated;

commit;
