-- =========================================
-- Re:Closet: Re:Closet Loopの「気になる」
-- clothing_item_likes テーブル、保存可否の判定関数、
-- ログインユーザー専用の状態取得RPC・気になる服一覧RPC
--
-- 背景: Re:Closet Loopで見つけた他のユーザーの公開服を、本人があとから
-- 見返すために「気になる」として保存できるようにする。
-- 公開いいね数・ランキング・誰が保存したかの表示は行わない
-- （保存した本人以外は、服の持ち主を含め誰も保存情報を読めない）。
--
-- 方針:
-- - 既存の clothing_items / clothing_images / profiles のRLS・GRANT、
--   公開RPC（list_public_clothing_items / get_public_clothing_item）は
--   変更しない。
-- - 保存できるのは「現在公開中」かつ「自分以外の服」だけ。
--   authenticatedは他人の服をRLSで読めないため、判定はsecurity definerの
--   関数（is_likeable_clothing_item）で行い、INSERTポリシーから呼ぶ。
-- - 非公開にされた服の保存行は削除せず残す。状態取得・一覧のRPCは
--   必ず is_public の服だけを返すため、非公開の間はユーザーから見えず、
--   再公開されると以前の保存がそのまま戻る。
-- - 服の削除・ユーザーの削除では ON DELETE CASCADE で保存も消える。
-- - 新しいpublic tableのため、2026/10/30以降のSupabase Data API変更に
--   合わせ、テーブル・関数ともGRANTを明示する（anonには何も付与しない）。
--
-- 注意: このファイルはまだSupabaseに実行していません。
-- 既存migration (001-010) は変更していません。
-- =========================================

begin;

-- -----------------------------------------
-- 1. テーブル
-- 複合主キーで「同じユーザーが同じ服を重複保存できない」ことを保証する。
-- UPDATEで変更する列はないため、保存/解除はINSERT/DELETEのみで行う。
-- -----------------------------------------
create table public.clothing_item_likes (
  user_id          uuid not null references auth.users(id) on delete cascade,
  clothing_item_id uuid not null references public.clothing_items(id) on delete cascade,
  created_at       timestamptz not null default now(),
  primary key (user_id, clothing_item_id)
);

comment on table public.clothing_item_likes is
  'Re:Closet Loopの「気になる」。保存した本人だけが読み書きできる。
   公開いいね数・誰が保存したかは公開しない。';

-- -----------------------------------------
-- 2. インデックス
-- 主キー(user_id, clothing_item_id)で本人の一覧は引けるため、
-- 服削除時のCASCADE用にclothing_item_id側だけ追加する。
-- -----------------------------------------
create index idx_clothing_item_likes_clothing_item_id
  on public.clothing_item_likes (clothing_item_id);

-- -----------------------------------------
-- 3. RLS有効化
-- -----------------------------------------
alter table public.clothing_item_likes enable row level security;

-- -----------------------------------------
-- 4. 保存可否の判定関数（INSERTポリシー用）
-- 対象が「現在公開中」かつ「呼び出したユーザー自身の服ではない」ときだけtrue。
-- 未ログイン（auth.uid() = null）では常にfalse。
-- security definer: authenticatedは他人の服をRLSで読めないため。
-- 戻り値はbooleanのみで、分かるのは「公開中で自分の服ではない」ことだけ。
-- -----------------------------------------
create or replace function public.is_likeable_clothing_item(p_item_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.clothing_items ci
    where ci.id = p_item_id
      and ci.is_public
      and ci.user_id <> (select auth.uid())
  );
$$;

-- -----------------------------------------
-- 5. RLSポリシー
-- SELECT / DELETE: 自分の保存だけ。
-- INSERT: 自分として、公開中の他人の服にだけ保存できる。
-- UPDATE: ポリシーもGRANTも作らない（変更不可）。
-- -----------------------------------------
create policy "clothing_item_likes_select_own"
  on public.clothing_item_likes for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy "clothing_item_likes_insert_own_public"
  on public.clothing_item_likes for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and public.is_likeable_clothing_item(clothing_item_id)
  );

create policy "clothing_item_likes_delete_own"
  on public.clothing_item_likes for delete
  to authenticated
  using (user_id = (select auth.uid()));

-- -----------------------------------------
-- 6. 状態取得RPC（Loop一覧・詳細用、ログインユーザー専用）
-- 渡されたidのうち公開中の服についてだけ、本人が保存済みか・本人の服かを返す。
-- 非公開・存在しないidは行を返さない。一度に扱うidは最大100件。
-- -----------------------------------------
create or replace function public.get_my_loop_item_states(p_item_ids uuid[])
returns table (
  item_id uuid,
  is_liked boolean,
  is_owner boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    ci.id,
    exists (
      select 1
      from public.clothing_item_likes l
      where l.user_id = (select auth.uid())
        and l.clothing_item_id = ci.id
    ),
    ci.user_id = (select auth.uid())
  from public.clothing_items ci
  where (select auth.uid()) is not null
    and ci.id = any (p_item_ids[1:100])
    and ci.is_public;
$$;

-- -----------------------------------------
-- 7. 気になる服一覧RPC（/protected/likes用、ログインユーザー専用）
-- 本人の保存のうち、現在公開中の服だけを新しく保存した順に返す。
-- 返す列は list_public_clothing_items（008）と同じ公開してよい列に
-- liked_at を加えたもの。最大100件。
-- -----------------------------------------
create or replace function public.list_my_liked_public_clothing_items()
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
-- 8. GRANT
-- テーブル: anon・PUBLICには何も付与しない。authenticatedには
--   select / insert / delete のみ（updateは付与しない）。
-- 関数: Postgresは作成時にPUBLICへEXECUTEを付与し、Supabaseの既定権限で
--   anonにも付与される場合があるため、PUBLIC・anonの両方からrevokeした
--   うえでauthenticatedにだけ付与する。
-- -----------------------------------------
revoke all on table public.clothing_item_likes from anon, public;
revoke all on table public.clothing_item_likes from authenticated;
grant select, insert, delete on table public.clothing_item_likes to authenticated;

revoke all on function public.is_likeable_clothing_item(uuid) from public, anon;
revoke all on function public.get_my_loop_item_states(uuid[]) from public, anon;
revoke all on function public.list_my_liked_public_clothing_items() from public, anon;

grant execute on function public.is_likeable_clothing_item(uuid) to authenticated;
grant execute on function public.get_my_loop_item_states(uuid[]) to authenticated;
grant execute on function public.list_my_liked_public_clothing_items() to authenticated;

commit;
