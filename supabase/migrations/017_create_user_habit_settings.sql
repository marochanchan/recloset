-- =========================================
-- Re:closet: 習慣化の設定（週次の見直し目標）
-- public.user_habit_settings
--
-- 方針:
-- - 1ユーザー1行。user_id を主キーにする（auth.users の削除で連動して消える）
-- - weekly_review_goal: 週に見直す服の目標。3・7・14、または null（目標なし）。
--   行がない（未保存）場合、アプリは週3着として扱う（lib/habit-progress.ts）
-- - updated_at はアプリが保存のたびに設定する（DBトリガーは使わない。014と同じ）
-- - RLS: 本人（user_id = auth.uid()）だけが SELECT/INSERT/UPDATE できる。
--   DELETE のポリシー・GRANTは作らない（設定は消さず、目標なしは null で表す）
-- - GRANT: anon・PUBLICには何も与えない。authenticatedには SELECT/INSERT/UPDATE だけ
--   （一度すべて取り消してから付与する。014・015と同じ）
--
-- 保存方式: アプリは upsert（INSERT ... ON CONFLICT (user_id) DO UPDATE）で
-- user_id・weekly_review_goal・updated_at を送る。Data API（PostgREST）の upsert は
-- 送った列すべてを DO UPDATE SET に含めるため、UPDATE権限は列を絞らず
-- テーブル単位で与える（user_id を書き換えても、RLSの with check により
-- 本人のIDにしかならない）。supabase/tests/017_user_habit_settings.test.sql で検証。
--
-- 既存のテーブル・ポリシー・GRANTは変更しない。
-- 前提: 001〜016 が適用済みであること（依存するのは auth.users・auth.uid() だけ）。
-- =========================================

begin;

-- -----------------------------------------
-- 1. テーブル
-- -----------------------------------------
create table public.user_habit_settings (
  user_id uuid primary key default auth.uid()
    references auth.users(id) on delete cascade,
  weekly_review_goal smallint
    constraint user_habit_settings_weekly_review_goal_check
    check (weekly_review_goal in (3, 7, 14)),
  updated_at timestamptz not null default now()
);

comment on table public.user_habit_settings is
  '習慣化の設定（1ユーザー1行）。行がない場合、アプリは初期値（週3着）として扱う。';
comment on column public.user_habit_settings.weekly_review_goal is
  '週次の見直し目標（着数）。3・7・14、または null（目標なし）。
   AI診断とスワイプの見直しを合わせ、同じ週の同じ服は1着として数える。着用記録は含めない。';
comment on column public.user_habit_settings.updated_at is
  'アプリが保存のたびに設定する（DBトリガーは使わない）。';

-- -----------------------------------------
-- 2. RLS
-- -----------------------------------------
alter table public.user_habit_settings enable row level security;

create policy "user_habit_settings_select_own"
  on public.user_habit_settings for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy "user_habit_settings_insert_own"
  on public.user_habit_settings for insert
  to authenticated
  with check (user_id = (select auth.uid()));

create policy "user_habit_settings_update_own"
  on public.user_habit_settings for update
  to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- DELETE のポリシーは作らない（GRANTもしないため、削除は権限エラーになる）

-- -----------------------------------------
-- 3. GRANT
-- Supabaseの既定権限で anon・authenticated に直接付与される場合があるため、
-- PUBLIC・anon・authenticated から一度すべて取り消してから、必要な権限だけ付与する
-- -----------------------------------------
revoke all on table public.user_habit_settings from public, anon, authenticated;
grant select, insert, update on table public.user_habit_settings to authenticated;

commit;
