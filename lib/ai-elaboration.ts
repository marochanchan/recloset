import { generateText } from "ai";
import {
  CURRENT_FEELING_OPTIONS,
  NOT_WORN_REASON_OPTIONS,
  WANT_TO_WEAR_AGAIN_OPTIONS,
  type DiagnosisDecisionChoice,
  type DiagnosisFact,
  type DiagnosisFeelingInput,
} from "@/lib/ai-diagnosis";
import { getCategoryLabel, getSeasonLabel } from "@/lib/clothing-options";
import type { NextAction } from "@/lib/next-action";

// ============================================================
// Gemini補足生成（Vercel AI Gateway経由）
//
// Jevとの役割分担:
// - Jev: KEEP/RETRY/REBYEの構造化判断（lib/ai-diagnosis.ts、変更しない）
// - Gemini: ユーザーが「もっと詳しく考える」を押した場合だけ、
//   診断結果（decision・FACT・FEELING・NextAction）を踏まえた
//   短い自然文の補足を1回だけ生成する
//
// runAiDiagnosis（通常の診断フロー）からは呼ばれない。
// ============================================================

export const GEMINI_ELABORATION_MODEL = "google/gemini-2.5-flash-lite";

// 短い日本語1〜3文の用途であり、長文生成を防ぐための小さい上限。
// AI SDK v7の generateText は `maxOutputTokens` を使う
// （旧 `maxTokens` ではない）。
const MAX_OUTPUT_TOKENS = 200;

const CURRENT_SEASON_LABELS: Record<DiagnosisFact["current_season"], string> =
  {
    spring: "春",
    summer: "夏",
    autumn: "秋",
    winter: "冬",
  };

// Re:closetの基本思想（AIが答えを決めるのではなく、本人が考える材料を
// 増やす）を崩さないための厳守事項を明記する。KEEP/RETRY/REBYEのどれでも
// 同じ指示を使う（出力の方向性はdecision/next_actionの内容から自然に
// 決まるため、decisionごとに別の指示文は用意しない）。
const ELABORATION_SYSTEM_PROMPT =
  "あなたはRe:closetというアプリの一部で、ユーザーが手持ちの服について" +
  "「残す・もう一度試す・手放す」を考えるための短い補足コメントを書きます。" +
  "次を厳守してください。" +
  "「手放すべき」「残すべき」「手放すのがおすすめ」のような最終判断や命令は" +
  "書かないこと。与えられたdecisionとNext Actionの結論を変えたり否定したり" +
  "しないこと。断定を避け、「かもしれません」「してみましょう」のように、" +
  "本人が考えるための視点を提示する文体にすること。なぜ迷っている可能性が" +
  "あるか、次に何を試すと判断しやすくなるか、本人が考えるための視点を中心に" +
  "書くこと。日本語で1〜3文、短く丁寧に書くこと。" +
  "「AIの答え」「AIのおすすめ」のような表現は使わないこと。";

export type ElaborationSnapshot = {
  decision: DiagnosisDecisionChoice;
  fact: DiagnosisFact;
  feeling: DiagnosisFeelingInput;
  nextAction: Pick<NextAction, "title" | "message">;
};

function findLabel<T extends string>(
  options: readonly { value: T; label: string }[],
  value: T,
): string {
  return options.find((option) => option.value === value)?.label ?? value;
}

/**
 * Geminiへ送るプロンプトを組み立てる。
 * user_id・clothing_item_id・title・brand・purchase_price・画像・Storage URL等、
 * 補足生成に不要な情報は一切含めない
 * （Jevへ送るstateと同じ「必要最小限」の方針を踏襲する）。
 */
function buildElaborationPrompt(snapshot: ElaborationSnapshot): string {
  const { decision, fact, feeling, nextAction } = snapshot;
  const notWornReasonLabels = feeling.notWornReasons
    .map((reason) => findLabel(NOT_WORN_REASON_OPTIONS, reason))
    .join("、");

  return [
    "以下はある服のAI診断結果です。本人がもう少し考えるための短い補足コメントを書いてください。",
    "",
    `診断タイプ: ${decision}`,
    `カテゴリー: ${getCategoryLabel(fact.category)}`,
    `シーズン: ${fact.season ? getSeasonLabel(fact.season) : "未登録"}`,
    `現在の季節: ${CURRENT_SEASON_LABELS[fact.current_season]}`,
    `お気に入り: ${fact.favorite ? "はい" : "いいえ"}`,
    `最後に着てからの日数: ${fact.days_since_last_worn ?? "着用記録なし"}`,
    `購入してからの日数: ${fact.days_since_purchase ?? "不明"}`,
    `今の気持ち: ${findLabel(CURRENT_FEELING_OPTIONS, feeling.currentFeeling)}`,
    `もう一度着たいか: ${findLabel(WANT_TO_WEAR_AGAIN_OPTIONS, feeling.wantToWearAgain)}`,
    `着ていない理由: ${notWornReasonLabels}`,
    "提示されたNext Action:",
    `  タイトル: ${nextAction.title}`,
    `  本文: ${nextAction.message}`,
  ].join("\n");
}

/**
 * Vercel AI Gateway経由でGeminiを1回呼び、短い自然文の補足を生成する。
 * disallowPromptTraining: true を指定し、プロンプトを学習に使わない
 * プロバイダへのルーティングを要求する
 * （zeroDataRetentionはプラン・プロバイダ対応状況に依存するため、今回は
 * 指定しない）。
 */
export async function runGeminiElaboration(
  snapshot: ElaborationSnapshot,
): Promise<string> {
  const { text } = await generateText({
    model: GEMINI_ELABORATION_MODEL,
    system: ELABORATION_SYSTEM_PROMPT,
    prompt: buildElaborationPrompt(snapshot),
    maxOutputTokens: MAX_OUTPUT_TOKENS,
    providerOptions: {
      gateway: {
        disallowPromptTraining: true,
      },
    },
  });

  return text.trim();
}
