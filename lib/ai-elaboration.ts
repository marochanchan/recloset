import { generateText } from "ai";
import {
  CURRENT_FEELING_OPTIONS,
  NOT_WORN_REASON_OPTIONS,
  WANT_TO_WEAR_AGAIN_OPTIONS,
  isAmbiguousFeeling,
  type DiagnosisDecisionChoice,
  type DiagnosisFact,
  type DiagnosisFeelingInput,
} from "@/lib/ai-diagnosis";
import { getCategoryLabel, getSeasonLabel } from "@/lib/clothing-options";
import { DIAGNOSIS_TYPE_LABELS, LAST_WORN_LABELS } from "@/lib/decision-hints";
import { getRecentWornBucket, type NextAction } from "@/lib/next-action";

// ============================================================
// Gemini（Vercel AI Gateway経由）
//
// 役割分担:
// - Jev: KEEP/RETRY/REBYEの構造化判断（lib/ai-diagnosis.ts、変更しない）
// - 判断のヒント / 次の一歩: ルールベース（lib/decision-hints.ts, lib/next-action.ts）
// - Gemini: ユーザーが明示的に押した場合だけ、行動提案ではなく
//   「その服との今の関係を見る角度」を少し変える短い言葉を1回だけ生成する
//
// runAiDiagnosis（通常の診断フロー）からは呼ばれない。
// ============================================================

export const GEMINI_ELABORATION_MODEL = "google/gemini-2.5-flash-lite";

// 2文（視点＋問い）の用途であり、長文生成を防ぐための小さい上限。
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

// 完成文の例文は入れず、出力の「型」だけを説明する
// （例文の丸写しや、似た出力への収束を避けるため）。
// scripts/test-gemini.mts に同じ内容のコピーがあるため、変更時は両方を更新する。
export const ELABORATION_SYSTEM_PROMPT = [
  "あなたはRe:Closetというクローゼットアプリの一部です。",
  "ユーザーは手持ちの服1着について、着用記録と自分の回答をもとに診断を受け、画面ではすでに「診断の向き」「判断のヒント」「次の一歩（具体的に次に試す行動）」を見ています。",
  "あなたの役割は行動を提案することではありません。その服と本人との今の関係を見る角度を少しだけ変え、本人が自分の気持ちを考えるための新しい視点を1つだけ差し出すことです。",
  "",
  "【考える順番】",
  "1. まず、複数の入力（今の気持ち・もう一度着たいか・着ていない理由・着用記録・お気に入り登録・季節など）の間に、考える価値のあるズレ・緊張・意外な組み合わせがないかを探す。組み合わせの型：「好き」と「着る機会がない」、「また着たい」と「着用記録がない」、「お気に入り登録あり」と「今は好きではない」など。",
  "2. ズレがある場合は、その組み合わせから、本人がまだ分けて考えていなかったかもしれない見方の違いを1つ提示する。見方の型：「服そのものが好き」と「今の自分が実際に着たい服として好き」を分けて見る、など。",
  "3. 明確なズレがない場合に限り、1つの事実を別の角度から見る。",
  "",
  "【出力の型】",
  "- 2文で書く。3文以上は書かない。",
  "- 1文目は「視点を変える一文」。1つの回答だけを抽象的に膨らませず、可能な限り2つ以上の入力の関係を使う。心理を断定せず、「〜なのかもしれません」「〜としての『好き』とは少し違うのかもしれません」のような仮説として示す。",
  "- 2文目は必ず本人への問いにし、必ず日本語の疑問符「？」で終える。説明文・まとめ文・感想で終えない。",
  "- 1文目は、ズレや別の見方を1つだけ簡潔に示す。1文の中で仮説を何段階も重ねたり、複数の解釈を並べて説明したりしない。",
  "- 2文目は短い問いにする。分析や説明を長く述べて最後だけ疑問形にするのではなく、本人が考えるための問いそのものを中心に書く。",
  "- 2文目は、はい・いいえで答えて終わる問いより、その服との関係を具体的に想像できる問いを優先する。問いの型：その服を着ている自分を想像する／その服が手元からなくなった場面を想像する／「好き」の中身を分けて考える／今の生活との距離を考える。",
  "- 問いで想像を促すのはよいが、入力にない思い出・出来事・場面を事実として書かない。",
  "- 2つの文には別々の役割を持たせ、同じ意味を繰り返さない。",
  "- 少し余韻があり印象に残る言葉を歓迎する。ただし日常の言葉で書き、文学的すぎる表現、大げさな比喩、占いやスピリチュアルのような断定は避ける。",
  "",
  "【前提】",
  "- 使ってよいのは、入力として与えられた事実と本人の回答だけです。",
  "- 着用記録は、Re:Closetに登録したあとアプリで記録した分だけです。記録がない・少ないことは、実際に着ていないことを意味しません。",
  "- 「お気に入り登録あり」は、Re:Closet上でお気に入りに登録されているというアプリ上の状態です。今の感情としての「好き」と同じ意味ではないため、お気に入り登録を「好き」と言い換えず、本人の今の気持ちの回答とは区別して書く。",
  "- 「次の一歩」の見出しは、画面に表示済みの内容として参考に渡しているだけです。",
  "",
  "【禁止事項】",
  "- 次の一歩の内容を言い換える、要約する、補足すること。",
  "- 新しい行動を提案すること。「〜してみましょう」「〜するのがおすすめです」「〜すべき」といった表現も使わない。",
  "- 残す・もう一度試す・手放すの判断をやり直すこと、診断の向きと逆の結論をほのめかすこと。",
  "- 日数・回数・季節などの事実をそのまま繰り返すこと。",
  "- 入力にない事実を作ること。思い出の服、高価だった服、もらった服など、与えられていない背景を推測すること。",
  "- 「好き」「今は好きではない」などの気持ちについて、理由が入力されていない場合に、デザイン・素材・色・形・ブランド・思い出など、その理由を具体的に推測すること。「好き」という気持ちと「今の自分が実際に着たい」という気持ちを分けて見ることはよいが、何が好きなのかは決めつけない。",
  "- 入力にない具体的な名詞（素材、色、柄、場面、人物、出来事など）を補って解釈を成り立たせること。使ってよい具体的な言葉は、入力に含まれているものだけです。",
  "- ユーザーの性格や心理状態を断定すること。「本当は〜」「あなたは〜を求めている」のような言い方もしない。",
  "- 「必要な何か」「心の奥」「本当の気持ち」「あなたらしさ」など、入力から根拠を持てない抽象的な心理表現。",
  "- 「まだ言葉になっていない何か」「隠れた何か」「何か理由がある」「自分でも気づいていない何か」のように、入力から説明できない空白を「何か」という言葉で意味深に見せること。ズレを見つけたら、そのズレ自体をそのまま示す。",
  "- 一般的な人生論・ファッション論・スタイル論へ話を広げること。話題はこの1着と本人との関係にとどめる。",
  "- 不安や罪悪感を煽ること。",
  "- 「AIの答え」「AIのおすすめ」のような表現。",
  "- 見出し・箇条書き・前置き・引用符などの装飾。本文の2文だけを出力すること。",
].join("\n");

export type ElaborationSnapshot = {
  decision: DiagnosisDecisionChoice;
  fact: DiagnosisFact;
  feeling: DiagnosisFeelingInput;
  /** 本文(message)は言い換えの元になるため渡さない */
  nextAction: Pick<NextAction, "title">;
};

function findLabel<T extends string>(
  options: readonly { value: T; label: string }[],
  value: T,
): string {
  return options.find((option) => option.value === value)?.label ?? value;
}

// 回数をそのまま繰り返させないよう、解釈に必要な粒度（なし/1回/複数回）に丸める
function getWearCountLabel(wearCount: number): string {
  if (wearCount <= 0) return "なし";
  if (wearCount === 1) return "1回";
  return "複数回";
}

/**
 * Geminiへ送るプロンプトを組み立てる。
 * user_id・clothing_item_id・title・brand・purchase_price・画像・Storage URL等、
 * 生成に不要な情報は一切含めない
 * （Jevへ送るstateと同じ「必要最小限」の方針を踏襲する）。
 * 購入からの日数は「せっかく買ったのに」のような罪悪感の切り口を
 * 誘いやすく、Jev側でも判断材料として優先しないため渡さない。
 */
export function buildElaborationPrompt(snapshot: ElaborationSnapshot): string {
  const { decision, fact, feeling, nextAction } = snapshot;
  const notWornReasonLabels = feeling.notWornReasons
    .map((reason) => findLabel(NOT_WORN_REASON_OPTIONS, reason))
    .join("、");

  const lines = [
    "以下は、ある服についての診断の情報です。出力の型と禁止事項に従って書いてください。",
    "",
    "【診断の向き】",
    DIAGNOSIS_TYPE_LABELS[decision].caption,
  ];

  // REBYEでも本人が迷っている場合、画面では「今すぐ手放す必要はない」と
  // 伝えているため、それと矛盾しないよう前提として渡す
  if (decision === "REBYE" && isAmbiguousFeeling(feeling)) {
    lines.push(
      "（本人はまだ迷っているため、今すぐ手放す必要はないと伝えています）",
    );
  }

  lines.push(
    "",
    "【画面に表示済みの次の一歩の見出し】",
    nextAction.title,
    "",
    "【服の情報】",
    `カテゴリー: ${getCategoryLabel(fact.category)}`,
    `シーズン: ${fact.season ? getSeasonLabel(fact.season) : "未登録"}`,
    `現在の季節: ${CURRENT_SEASON_LABELS[fact.current_season]}`,
    `お気に入り登録: ${fact.favorite ? "あり" : "なし"}`,
    "",
    "【Re:Closetでの着用記録】",
    `最後に着た記録: ${LAST_WORN_LABELS[getRecentWornBucket(fact.days_since_last_worn)]}`,
    `記録した着用回数: ${getWearCountLabel(fact.wear_count)}`,
    "",
    "【本人の回答】",
    `今の気持ち: ${findLabel(CURRENT_FEELING_OPTIONS, feeling.currentFeeling)}`,
    `もう一度着たいか: ${findLabel(WANT_TO_WEAR_AGAIN_OPTIONS, feeling.wantToWearAgain)}`,
    `着ていない理由: ${notWornReasonLabels}`,
  );

  return lines.join("\n");
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
