-- =========================================
-- Re:closet: AI診断履歴テーブル
-- ai_diagnoses
--
-- 背景: AI診断（Jev）の結果をその場限りで表示するだけでなく、
-- 後から履歴として確認できるようにする（AI診断v2の最初のステップ）。
-- 現時点ではGemini連携・status連携・レート制限・UIは含めない。
-- 必要になった時点で別migrationで追加する
-- （gemini_model / elaboration カラムも、Gemini実装時に追加する）。
--
-- 注意: このファイルはまだSupabaseに実行していません。
-- clothing_items / clothing_images / wear_logs および既存migration
-- (001-004) は変更していません。anon ロールへの権限付与は行いません。
-- =========================================

-- -----------------------------------------
-- 1. ai_diagnoses
-- -----------------------------------------
create table public.ai_diagnoses (
  id                      uuid primary key default gen_random_uuid(),
  clothing_item_id        uuid not null references public.clothing_items(id) on delete cascade,
  user_id                 uuid not null references auth.users(id) on delete cascade,
  decision                text not null
    check (decision in ('KEEP', 'RETRY', 'REBYE')),
  decision_probabilities  jsonb not null,
  fact                    jsonb not null,
  feeling                 jsonb not null,
  next_action             jsonb not null,
  model                   text not null,
  created_at              timestamptz not null default now()
);

comment on table public.ai_diagnoses is
  '診断は追記専用の履歴。update/deleteポリシーは設けず、親clothing_item削除時の
   on delete cascadeでのみ削除される。Gemini連携（gemini_model/elaboration列）は
   このmigrationには含めず、実装時に別migrationで追加する。';
comment on column public.ai_diagnoses.decision is
  'KEEP/RETRY/REBYEのみ許可するCHECK制約を設けている。category/statusなど他の
   text型カラムはアプリ側のクローズドな<select>からしか値が来ないためCHECK制約を
   付けていないが、decisionはJev（外部AI）の構造化出力をそのまま保存するため、
   想定外の値が混入するリスクが質的に異なる。履歴としての整合性を守るための
   最小限の安全策としてここだけCHECK制約を付けている。';
comment on column public.ai_diagnoses.decision_probabilities is
  'Jevのevaluate()が返すprobabilitiesをそのまま保存する（例: {"KEEP":0.1,"RETRY":0.8,"REBYE":0.1}）';
comment on column public.ai_diagnoses.fact is
  '診断時のDiagnosisFactスナップショット（wear_count, days_since_last_worn,
   days_since_purchase, favorite, category, season, current_season）。
   将来FACTの形が変わってもDDL変更不要にするためjsonbで保持する。';
comment on column public.ai_diagnoses.feeling is
  '診断時のユーザー回答スナップショット（current_feeling, want_to_wear_again, not_worn_reasons）';
comment on column public.ai_diagnoses.next_action is
  '診断時にユーザーへ実際に表示したNextAction（kind, title, message等）のスナップショット。
   後からメッセージ文言を変更しても、履歴には当時表示した内容がそのまま残る。';
comment on column public.ai_diagnoses.model is
  '診断（decision）に使用したmodel識別子。現時点では常に "typesafe-ai/jev"';

-- -----------------------------------------
-- 2. インデックス
-- -----------------------------------------

-- 「このアイテムの診断履歴を新しい順に」を想定した複合インデックス
create index idx_ai_diagnoses_clothing_item_id_created_at
  on public.ai_diagnoses (clothing_item_id, created_at desc);

-- RLSで全クエリに user_id = auth.uid() がかかるため必須級
create index idx_ai_diagnoses_user_id
  on public.ai_diagnoses (user_id);

-- -----------------------------------------
-- 3. RLS有効化
-- -----------------------------------------
alter table public.ai_diagnoses enable row level security;

-- -----------------------------------------
-- 4. RLSポリシー
-- 履歴は追記専用のため、update/deleteポリシーは設けない
-- （update/deleteはGRANTも付与しない。clothing_item削除時のCASCADEでのみ消える）。
-- -----------------------------------------

drop policy if exists "ai_diagnoses_select_own" on public.ai_diagnoses;
create policy "ai_diagnoses_select_own"
  on public.ai_diagnoses for select
  using (user_id = (select auth.uid()));

-- user_idの一致だけでなく、clothing_item_idが実際に本人の所有物であることも
-- 確認する。user_id単体のチェックだけでは、別ユーザーが所有する
-- clothing_item_idを自分のuser_idに紐付けて挿入できてしまうため
-- （clothing_images/wear_logsと同様、clothing_items経由の所有者確認を併用する）。
drop policy if exists "ai_diagnoses_insert_own" on public.ai_diagnoses;
create policy "ai_diagnoses_insert_own"
  on public.ai_diagnoses for insert
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.clothing_items ci
      where ci.id = ai_diagnoses.clothing_item_id
        and ci.user_id = (select auth.uid())
    )
  );

-- -----------------------------------------
-- 5. GRANT
-- 2026/10/30以降のSupabase Data API変更に備え、authenticatedロールへの
-- テーブル権限を明示する（schemaレベルのusage権限は002で付与済みのため
-- ここでは繰り返さない）。履歴は追記専用のため、update/deleteは付与しない。
-- -----------------------------------------
grant select, insert on public.ai_diagnoses to authenticated;
