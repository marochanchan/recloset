-- =========================================
-- Re:closet: ユーザープロフィール
-- profiles
--
-- 背景: 将来の公開服の所有者表示・公開コメントの投稿者表示・DM相手の
-- 表示などに向けて、「他ユーザーに見せてよい情報」だけを持つ最小テーブル。
-- auth.usersはクライアントから直接参照できず、メールアドレス等の
-- 個人情報を含むため、公開してよい情報だけをここに分離する。
--
-- 今回はprofilesの作成・新規登録時の自動生成・既存ユーザーのbackfillの
-- みを対象とする。以下はすべて今回のスコープ外（将来別migrationで追加）:
-- clothing_itemsの公開機能・Storage公開ポリシー・公開服一覧/詳細・
-- 公開コメント・conversations/messages・Realtime・フリマアプリ管理・
-- avatar・表示名変更UI。
--
-- 注意: このファイルはまだSupabaseに実行していません。
-- 既存migration (001-006) は変更していません。
-- anon ロールへの権限付与は行いません（5.参照）。
-- =========================================

-- -----------------------------------------
-- 1. profiles
-- -----------------------------------------
create table public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  created_at   timestamptz not null default now()
);

comment on table public.profiles is
  '他ユーザーに公開してよいプロフィール情報だけを持つテーブル。
   auth.usersの内容（メールアドレス等）は一切含めない。
   将来、公開服の所有者表示・公開コメントの投稿者表示・DM相手の表示に使う。
   avatar等の追加、表示名変更UIは今回のスコープ外。';
comment on column public.profiles.display_name is
  '他ユーザーに表示される名前。新規登録時はauth.users.idの一部から
   自動生成する（メールアドレスは一切使わない。2.参照）。
   表示名を変更するUIは今回実装しない。';

-- -----------------------------------------
-- 2. 新規ユーザー登録時の自動生成（auth.usersへのinsert trigger）
--
-- display_nameはメールアドレスを一切使わず、auth.users.id（uuid）の
-- 先頭8文字から生成する（例: "ユーザー3f9a2b1c"）。
-- メールアドレス全体はもちろん、@より前のローカル部分も本人を
-- 特定しうる情報として公開しないため使用しない。
--
-- security definer + search_path固定: signup時にauth.usersへinsertする
-- 実行コンテキストはauth.uid()を持たないため、通常のRLSに依存した
-- insertはできない。関数所有者（postgres相当）の権限で実行することで、
-- RLSを経由せず確実にprofilesの行を作成できるようにする。
-- search_pathを明示的に固定するのは、security definer関数における
-- 一般的なセキュリティ上の注意点への対応。
--
-- on conflict (id) do nothing により、何らかの理由でtriggerが
-- 複数回実行されても安全（冪等）。関数自体もcreate or replace、
-- triggerもdrop ... if exists + createのため、この2.のブロックだけを
-- 単独で再実行することは安全（冪等）。ただし1.のcreate tableには
-- if not existsを付けていないため、このmigrationファイル全体を
-- 最初から再実行すると1.の時点でエラーになる（下部の注意書き参照）。
-- -----------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, 'ユーザー' || substr(new.id::text, 1, 8))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- -----------------------------------------
-- 3. 既存ユーザーのbackfill
--
-- triggerは今後の新規登録にしか効かないため、既存のauth.usersに対して
-- 不足しているprofilesの行を補う。すでにprofilesがある行はwhere not
-- existsでスキップするため、この3.のinsert文だけを単独で再実行するのは
-- 安全（冪等）。ただし1.のcreate tableにはif not existsを付けていない
-- ため、このmigrationファイル全体としては冪等ではない
-- （下部の注意書き参照）。
-- -----------------------------------------
insert into public.profiles (id, display_name)
select u.id, 'ユーザー' || substr(u.id::text, 1, 8)
from auth.users u
where not exists (
  select 1 from public.profiles p where p.id = u.id
);

-- -----------------------------------------
-- 4. RLS有効化
-- -----------------------------------------
alter table public.profiles enable row level security;

-- -----------------------------------------
-- 5. RLSポリシー
--
-- display_nameは「他ユーザーに見せてよい情報」として設計しているため、
-- ログイン済みユーザー同士であれば全員のdisplay_nameを読めるようにする。
--
-- anonへは今回SELECTを許可しない。現時点で未ログインユーザーが
-- display_nameを読む必要のある画面（公開服一覧・公開コメント等）は
-- まだ実装されていないため。「将来必要になるから今広く許可する」のでは
-- なく、それらの機能を実装する時点で、その機能に本当に必要な最小範囲の
-- anon向けポリシーを別migrationで追加する方針とする。
--
-- insert/updateのポリシーは今回設けない。profilesの作成は2.のtrigger
-- （security definerでRLSを経由しない）でのみ行い、表示名の変更UIも
-- 今回実装しないため、クライアントからの書き込み経路自体を今は開けない。
-- -----------------------------------------
drop policy if exists "profiles_select_authenticated" on public.profiles;
create policy "profiles_select_authenticated"
  on public.profiles for select
  to authenticated
  using (true);

-- -----------------------------------------
-- 6. GRANT
-- 2026/10/30以降のSupabase Data API変更に備え、authenticatedロールへの
-- テーブル権限を明示する。selectのみ付与し、insert/updateは付与しない
-- （作成は2.のtriggerのみで行うため、クライアントからの書き込み経路を
-- 開けない）。anonへは何も付与しない（5.参照）。
-- -----------------------------------------
grant select on public.profiles to authenticated;

-- -----------------------------------------
-- 注意: このファイル全体の再実行について
-- 1.の `create table public.profiles` は `if not exists` を付けていない
-- ため、このファイルを最初から最後まで再実行すると、profilesが既に
-- 存在する場合は1.の時点で "relation already exists" エラーになる。
-- 2.（関数・trigger）・3.（backfill）・5.（policy）の各ブロックは
-- それぞれ単独では再実行に強い書き方にしているが、ファイル全体としての
-- 再実行（migration全体の再適用）を安全に行える設計ではない。
-- 再実行が必要な場合は、1.を除くブロックだけを個別に実行すること。
-- -----------------------------------------
