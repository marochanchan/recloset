-- =========================================
-- Re:closet: ai_diagnosesへGemini補足カラムを追加
-- gemini_model / elaboration
--
-- 背景: 「もっと詳しく考える」ボタンを押した場合のみ、Vercel AI Gateway
-- 経由でGeminiを1回呼び、短い自然文の補足をai_diagnosesの該当行へ
-- 追記できるようにする（Gemini追加v1）。
-- 通常のJev診断フロー（runAiDiagnosis）はこのmigrationの影響を受けない。
--
-- 注意: このファイルはまだSupabaseに実行していません。
-- 005_create_ai_diagnoses.sql は変更していません。
-- anon ロールへの権限付与は行いません。
-- =========================================

-- -----------------------------------------
-- 1. カラム追加（どちらもnullable。Geminiはオプトイン機能のため、
-- 大半の診断行はこの2列がnullのまま）
-- -----------------------------------------
alter table public.ai_diagnoses
  add column gemini_model text,
  add column elaboration text;

comment on column public.ai_diagnoses.gemini_model is
  '「もっと詳しく考える」ボタン押下時にGemini補足を生成した場合のmodel識別子
   （例: "google/gemini-2.5-flash-lite"）。未生成の行はnull。';
comment on column public.ai_diagnoses.elaboration is
  'Geminiが生成した短い自然文の補足（1診断1回まで）。未生成の行はnull。
   生成済みの行は再生成しない（4.のRLSポリシーと2.の列GRANTで強制する）。';

-- -----------------------------------------
-- 2. GRANT
-- elaboration / gemini_model の2列だけUPDATEを許可する。
-- decision / fact / feeling / next_action 等、他の列へのUPDATE権限は
-- 一切付与しない（履歴としての整合性を守るため、ai_diagnoses全体への
-- 広いUPDATE権限は与えない）。
-- -----------------------------------------
grant update (elaboration, gemini_model) on public.ai_diagnoses to authenticated;

-- -----------------------------------------
-- 3. RLSポリシー
-- 自分の行で、かつelaborationがまだ設定されていない行だけ更新できる。
-- 既にelaborationが入っている行はusing句を満たさずUPDATE対象が0件になる
-- （＝同じ診断へのGemini結果の再生成をDBレベルで防ぐ）。
-- -----------------------------------------
drop policy if exists "ai_diagnoses_update_elaboration_own" on public.ai_diagnoses;
create policy "ai_diagnoses_update_elaboration_own"
  on public.ai_diagnoses for update
  using (
    user_id = (select auth.uid())
    and elaboration is null
  )
  with check (
    user_id = (select auth.uid())
  );
