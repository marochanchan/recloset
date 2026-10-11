-- =========================================
-- Re:Closet: スワイプ式の見直しセッション
--   public.closet_review_sessions  … 1回の見直し（選んだ服の並び）
--   public.closet_review_decisions … 服ごとの判断（残す・迷う・手放し候補・スキップ）
--
-- 背景: 服を1着ずつテンポよく見直し、途中で終えても続きから再開できるようにする。
-- 判断の履歴は、将来の行動記録・進捗表示（Re:Garden・Re:Quest・Re:Story）にも使う。
--
-- 方針:
-- - 判断は履歴として残すだけ。clothing_items.status などの服の情報は変更しない
--   （手放し候補にしても status は変わらない。削除・公開・出品も行わない）。
-- - ai_diagnoses（AI診断）とは別のテーブルにする。AI診断の画面・今日見直す3着の
--   「診断した服は30日間外す」の判定には影響しない。
-- - セッション: 開始時に選んだ服のID（最大10着、並び順どおり）を item_ids に固定する。
--   再開時は item_ids のうち、まだ判断していない服から続ける（有効期限なし）。
--   completed_at は最後の服まで進んだとき（または残りの服がなくなったとき）に
--   アプリが設定する（列単位のGRANTでUPDATEできるのはこの列だけ。item_ids・
--   user_id は作成後に変えられない）。セッションは削除しない（過去の履歴を残す）。
-- - 未完了のセッションは1人1つだけ（部分UNIQUEインデックス）。同時に作成した場合は
--   片方が 23505 で失敗するので、アプリは既存の未完了セッションを読み直す。
-- - item_ids は重複なし・すべて本人の服であることを、作成時にトリガーで確かめる
--   （CHECK制約では他の表を参照できないため）。件数（1〜10着）はCHECK制約で保証する。
-- - 判断: 1セッションの中で、1着につき1行（UNIQUE）。
--   「1つ前に戻す」は、そのセッションの直前の判断の行を削除する。
--   判断の行は書き換えない（UPDATEは許可しない）。
--   別のセッションで同じ服をもう一度見直した場合は、新しい行として残る。
-- - skip は「判断済み」に数えない（アプリ側の集計で除く）。行は残すため、
--   再開時に同じ服を何度も出さずに済む。
-- - 服を削除したときは、その服の判断の行も消える（on delete cascade。
--   既存の ai_diagnoses・clothing_images と同じ扱い）。
-- - RLS: 本人（user_id = auth.uid()）だけ。判断の追加は、本人のセッションで、
--   そのセッションに含まれる本人の服に限る。
-- - GRANT: anon・PUBLICには何も与えない（一度すべて取り消してから付与する）。
-- - 既存のテーブル・データ・公開RPC・Storageは変更しない。
--
-- 適用: Supabase SQL Editor で、このファイル全体を1回だけ実行する。
-- 注意: このファイルはまだSupabaseに実行していません。
-- 既存migration (001-014) は変更していません。
-- =========================================

begin;

-- -----------------------------------------
-- セッション
-- -----------------------------------------
create table public.closet_review_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid()
    references auth.users(id) on delete cascade,
  item_ids uuid[] not null,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint closet_review_sessions_item_ids_size
    check (cardinality(item_ids) between 1 and 10)
);

comment on table public.closet_review_sessions is
  'スワイプ式の見直しの1回分。item_ids は開始時に選んだ服（並び順どおり、最大10着）。服の情報は変更しない';
comment on column public.closet_review_sessions.completed_at is
  '最後の服まで進んだ日時。nullは途中（再開できる）';

-- 本人の最新のセッション（再開の判定）
create index idx_closet_review_sessions_user_id_created_at
  on public.closet_review_sessions (user_id, created_at desc);

-- 未完了のセッションは1人1つだけ
create unique index uq_closet_review_sessions_user_id_open
  on public.closet_review_sessions (user_id)
  where completed_at is null;

-- 作成時に、item_ids が重複なし・すべて本人の服であることを確かめる。
-- security invoker（既定）で実行するため、clothing_items のRLSにより
-- 本人の服しか数えられない（他人の服のIDを入れると件数が合わず失敗する）
create function public.check_closet_review_session_items()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (
    select count(distinct i.id)
    from public.clothing_items i
    where i.id = any (new.item_ids)
      and i.user_id = new.user_id
  ) <> cardinality(new.item_ids) then
    raise exception 'item_ids must be distinct clothing items owned by the user'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function public.check_closet_review_session_items() from public, anon, authenticated;

create trigger trg_closet_review_sessions_check_items
  before insert on public.closet_review_sessions
  for each row execute function public.check_closet_review_session_items();

-- -----------------------------------------
-- 判断
-- -----------------------------------------
create table public.closet_review_decisions (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null
    references public.closet_review_sessions(id) on delete cascade,
  user_id uuid not null default auth.uid()
    references auth.users(id) on delete cascade,
  clothing_item_id uuid not null
    references public.clothing_items(id) on delete cascade,
  decision text not null
    check (decision in ('keep', 'unsure', 'let_go_candidate', 'skip')),
  created_at timestamptz not null default now(),
  constraint closet_review_decisions_one_per_item
    unique (session_id, clothing_item_id)
);

comment on table public.closet_review_decisions is
  'スワイプ式の見直しの判断履歴。keep=残す、unsure=迷う、let_go_candidate=手放し候補、skip=スキップ（判断済みに数えない）。clothing_items.statusは変更しない';

-- 服ごとの最後の見直し日（選定で「最近見直していない服」を優先する）
create index idx_closet_review_decisions_user_id_item_created_at
  on public.closet_review_decisions (user_id, clothing_item_id, created_at desc);
-- clothing_items の削除時（cascade）の検索用
create index idx_closet_review_decisions_clothing_item_id
  on public.closet_review_decisions (clothing_item_id);

-- -----------------------------------------
-- RLS: 本人だけ
-- -----------------------------------------
alter table public.closet_review_sessions enable row level security;
alter table public.closet_review_decisions enable row level security;

create policy "closet_review_sessions_select_own"
  on public.closet_review_sessions for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy "closet_review_sessions_insert_own"
  on public.closet_review_sessions for insert
  to authenticated
  with check (user_id = (select auth.uid()));

create policy "closet_review_sessions_update_own"
  on public.closet_review_sessions for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "closet_review_decisions_select_own"
  on public.closet_review_decisions for select
  to authenticated
  using (user_id = (select auth.uid()));

-- 本人のセッションで、そのセッションに含まれる本人の服だけ
create policy "closet_review_decisions_insert_own"
  on public.closet_review_decisions for insert
  to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1
      from public.closet_review_sessions s
      where s.id = closet_review_decisions.session_id
        and s.user_id = (select auth.uid())
        and closet_review_decisions.clothing_item_id = any (s.item_ids)
    )
    and exists (
      select 1
      from public.clothing_items i
      where i.id = closet_review_decisions.clothing_item_id
        and i.user_id = (select auth.uid())
    )
  );

-- 「1つ前に戻す」用
create policy "closet_review_decisions_delete_own"
  on public.closet_review_decisions for delete
  to authenticated
  using (user_id = (select auth.uid()));

-- -----------------------------------------
-- GRANT: anon・PUBLICには何も与えない
-- -----------------------------------------
revoke all on table public.closet_review_sessions from public, anon, authenticated;
grant select, insert on table public.closet_review_sessions to authenticated;
-- 更新できるのは completed_at だけ
grant update (completed_at) on table public.closet_review_sessions to authenticated;

revoke all on table public.closet_review_decisions from public, anon, authenticated;
grant select, insert, delete on table public.closet_review_decisions to authenticated;

commit;

notify pgrst, 'reload schema';
