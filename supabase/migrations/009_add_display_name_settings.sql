-- =========================================
-- Re:closet: 公開名（ニックネーム）設定のためのprofiles変更
-- profiles.display_name
--
-- 背景: 007ではsignup時・backfill時にdisplay_nameを
-- 'ユーザー' || substr(id::text, 1, 8) で自動生成していた。これは
-- user_idの先頭8文字そのものであり、公開服ページ（/discover）で
-- 所有者名として表示するとuser_idの断片を公開することになる。
-- また、ユーザーが自分で公開名を設定する手段もなかった。
--
-- 方針:
-- - display_name = null を「公開名が未設定」、値ありを「本人が設定した
--   公開名」とする。空文字は使わない（CHECK制約で禁止）。
-- - ID由来の仮の名前は廃止し、既存の仮の名前だけをnullへ戻す。
-- - 本人だけが自分の行のdisplay_name列だけを更新できるようにする。
-- - 名前の重複は許可する（表示名であり、識別子ではないため）。
--
-- 変更しないもの: 001〜008、profilesの既存SELECTポリシー
-- （profiles_select_authenticated）、anonへの権限（何も付与しない）、
-- migration 008の公開RPC・Storageポリシー、clothing系テーブルのRLS。
-- 公開RPCはこれまでどおりdisplay_nameだけを返し、未設定ならnullを返す
-- （公開ページ側で「Re:closetユーザー」と表示する）。
--
-- 注意: このファイルはまだSupabaseに実行していません。
-- 既存migration (001-008) は変更していません。
-- =========================================

-- -----------------------------------------
-- 1. display_nameをnullableにする
-- 再実行可: 既にnullableでもエラーにならない。
-- -----------------------------------------
alter table public.profiles
  alter column display_name drop not null;

comment on column public.profiles.display_name is
  '他ユーザーに表示される公開名（ニックネーム）。nullは「本人が未設定」。
   本人だけが設定・変更できる（5.のポリシーと6.の列単位GRANT）。
   メールアドレスやuser_id由来の文字列は自動で入れない。
   公開服ページ・将来の公開コメント・DMでの表示名として使う。';

-- -----------------------------------------
-- 2. 007で自動生成した仮の名前だけをnullへ戻す
-- 各行のidから007と同じ式で生成した値と完全一致する場合だけ対象にする
-- （本人が設定した任意の名前は、たまたま同じ文字列でない限り消さない。
--  他人のidから作られた文字列と一致しても対象にならない）。
-- 再実行可: 一度nullにした行は条件に一致しなくなるため冪等。
-- -----------------------------------------
update public.profiles
set display_name = null
where display_name = 'ユーザー' || substr(id::text, 1, 8);

-- -----------------------------------------
-- 3. display_nameの形式チェック（DBでの最終防衛線）
-- - nullは許可（未設定）
-- - 1〜20文字（char_lengthは文字数で数える。空文字は不可）
-- - 前後の空白は禁止（半角・タブ等の[[:space:]]に加え、btrimでは
--   除去されない全角スペースU+3000も明示的に禁止）
-- - 制御文字（改行・タブ等）は禁止
-- 日本語・英数字・記号・絵文字は上記を満たす限り使用できる。
-- UNIQUE制約は付けない（重複を許可）。
--
-- 2.の後に追加するため、既存の仮の名前（12文字・条件を満たす）が
-- 残っていたとしても制約の追加は失敗しない。
-- 再実行可: drop constraint if exists を前置している。
-- -----------------------------------------
alter table public.profiles
  drop constraint if exists profiles_display_name_format;

alter table public.profiles
  add constraint profiles_display_name_format
  check (
    display_name is null
    or (
      char_length(display_name) between 1 and 20
      and display_name !~ E'^[[:space:]　]'
      and display_name !~ E'[[:space:]　]$'
      and display_name !~ '[[:cntrl:]]'
    )
  );

-- -----------------------------------------
-- 4. signup triggerの関数を変更
-- profilesの行は引き続き自動生成するが、idだけを設定し、display_nameは
-- null（未設定）のままにする。メールアドレスやuser_id由来の文字列は
-- 一切使わない。
-- on_auth_user_created trigger自体は007のものをそのまま使う
-- （関数をcreate or replaceで差し替えるだけなので、triggerの再作成は不要）。
-- security definer の理由は007と同じ（signup時の実行コンテキストは
-- auth.uid()を持たず、RLS経由のinsertができないため）。
-- search_pathは '' に固定し、テーブルはschema修飾で参照する。
-- 再実行可: create or replace。
-- -----------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id)
  values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

-- -----------------------------------------
-- 5. RLSポリシー: 本人だけが自分の行を更新できる
-- どの列を更新できるかは6.の列単位GRANTで制限する
-- （ポリシーは行、GRANTは列を制限する）。
-- with checkも本人に限定し、更新後の行が他人のidになることも防ぐ
-- （idはそもそも6.で更新権限を与えない）。
-- insert/deleteのポリシーは引き続き設けない。
-- 再実行可: drop policy if exists を前置している。
-- -----------------------------------------
drop policy if exists "profiles_update_own_display_name" on public.profiles;
create policy "profiles_update_own_display_name"
  on public.profiles for update
  to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- -----------------------------------------
-- 6. GRANT: authenticatedにはdisplay_name列のUPDATEだけを許可する
-- 2026/10/30以降のSupabase Data API変更に備え、権限を明示する。
--
-- 先にテーブル単位のUPDATEをrevokeする理由: テーブル単位のUPDATE権限が
-- 残っていると、列単位のGRANTに関係なくid/created_atも更新できてしまう。
-- 001〜008ではprofilesへのUPDATEを付与していないが、Supabaseのデフォルト
-- 権限等で付与されていた場合にも「display_name列だけ」を確実にするため、
-- 一度revokeしてから列単位でgrantする（テーブル単位のrevokeは、各列の
-- 列単位権限も同時に取り消す）。
--
-- select（007で付与済み）・anonの権限・insert/deleteには触れない。
-- 再実行可: revoke/grantは何度実行しても同じ状態になる。
-- -----------------------------------------
revoke update on public.profiles from authenticated;
grant update (display_name) on public.profiles to authenticated;

-- -----------------------------------------
-- 注意: このファイル全体の再実行について
-- 1.〜6.のすべてのブロックを再実行可能な書き方にしているため、
-- このファイル全体を最初から再実行しても同じ状態になる。
-- ただし2.は「その時点で仮の名前と完全一致する行」をnullにするため、
-- 適用後に本人が偶然 'ユーザー' + 自分のid先頭8文字 と同じ名前を
-- 設定していた場合は、再実行でnullに戻る点に注意。
-- -----------------------------------------
