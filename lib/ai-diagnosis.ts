import { experimental_evaluate as evaluate } from "ai";

// ============================================================
// FEELING（ユーザー本人の気持ち）の選択肢・型
// ============================================================

export const CURRENT_FEELING_OPTIONS = [
  { value: "like", label: "好き" },
  { value: "neutral", label: "どちらでもない" },
  { value: "dislike", label: "今は好きではない" },
] as const;

export const WANT_TO_WEAR_AGAIN_OPTIONS = [
  { value: "yes", label: "また着たい" },
  { value: "unsure", label: "わからない" },
  { value: "no", label: "また着たいとは思わない" },
] as const;

export const NOT_WORN_REASON_OPTIONS = [
  { value: "out_of_season", label: "季節が合わない" },
  { value: "no_occasion", label: "着る機会がない" },
  { value: "hard_to_style", label: "コーディネートが難しい" },
  { value: "fit_or_comfort", label: "サイズ・着心地が合わない" },
  { value: "somehow_not_reaching_for_it", label: "なんとなく手が伸びない" },
  { value: "do_not_remember", label: "理由を覚えていない" },
  { value: "other", label: "その他" },
] as const;

export type CurrentFeeling = (typeof CURRENT_FEELING_OPTIONS)[number]["value"];
export type WantToWearAgain =
  (typeof WANT_TO_WEAR_AGAIN_OPTIONS)[number]["value"];
export type NotWornReason = (typeof NOT_WORN_REASON_OPTIONS)[number]["value"];

export type DiagnosisFeelingInput = {
  currentFeeling: CurrentFeeling;
  wantToWearAgain: WantToWearAgain;
  notWornReasons: NotWornReason[];
};

type RawFeelingInput = {
  currentFeeling: string;
  wantToWearAgain: string;
  notWornReasons: string[];
};

const MAX_NOT_WORN_REASONS = 2;

function isValidOption<T extends string>(
  options: readonly { value: T }[],
  value: string,
): value is T {
  return options.some((option) => option.value === value);
}

/**
 * クライアントから届いたFEELING回答を許可リストで検証する。
 * 不正な値であればnullを返す（クライアントを信用しない）。
 *
 * notWornReasonsの検証ルール:
 * - 1件以上、最大2件まで
 * - すべて許可リスト内の値
 * - 重複なし
 * - "do_not_remember" を含む場合は配列長が1であること（排他的な選択肢）
 */
export function validateFeelingInput(
  input: RawFeelingInput,
): DiagnosisFeelingInput | null {
  if (
    !isValidOption(CURRENT_FEELING_OPTIONS, input.currentFeeling) ||
    !isValidOption(WANT_TO_WEAR_AGAIN_OPTIONS, input.wantToWearAgain)
  ) {
    return null;
  }

  const { notWornReasons } = input;

  if (
    notWornReasons.length < 1 ||
    notWornReasons.length > MAX_NOT_WORN_REASONS
  ) {
    return null;
  }

  if (
    !notWornReasons.every((reason) =>
      isValidOption(NOT_WORN_REASON_OPTIONS, reason),
    )
  ) {
    return null;
  }

  if (new Set(notWornReasons).size !== notWornReasons.length) {
    return null; // 重複あり
  }

  if (
    notWornReasons.includes("do_not_remember") &&
    notWornReasons.length !== 1
  ) {
    return null;
  }

  return {
    currentFeeling: input.currentFeeling,
    wantToWearAgain: input.wantToWearAgain,
    notWornReasons: notWornReasons as NotWornReason[],
  };
}

/**
 * FEELING回答そのものに明確な迷いが含まれているかどうかを判定する。
 * Jevのprobabilitiesの割れ具合ではなく、ユーザー本人の回答内容だけを見る
 * （Re:closetの方針：「AIの確率が割れているから迷っている」ではなく
 * 「本人がまだ迷っているから、AIも結論を急がせない」を優先する）。
 *
 * notWornReasons（着ていない理由・複数可）は曖昧判定には使わない。
 * 「着ていない理由を覚えていない」だけでは、現在の気持ちや再着用意欲が
 * 明確な場合もあるため（例: 好き・また着たいが、着ていない理由は
 * 覚えていない、というケース）。理由の数についても曖昧判定には使わない。
 */
export function isAmbiguousFeeling(feeling: DiagnosisFeelingInput): boolean {
  return (
    feeling.currentFeeling === "neutral" ||
    feeling.wantToWearAgain === "unsure"
  );
}

// ============================================================
// FACT（サーバー側で計算する客観データ）の型
// statusは過去のユーザー判断であり客観的な利用実績ではないため、
// 診断のFACTには含めない（画面表示の参考情報としては別途利用してよい）。
// ============================================================

export type DiagnosisFact = {
  wear_count: number;
  days_since_last_worn: number | null;
  days_since_purchase: number | null;
  favorite: boolean;
  category: string;
  season: string | null;
  current_season: "spring" | "summer" | "autumn" | "winter";
};

// ============================================================
// Jev呼び出し
// ============================================================

export type DiagnosisDecisionChoice = "KEEP" | "RETRY" | "REBYE";

export type JevDiagnosisResult = {
  choice: DiagnosisDecisionChoice;
  probabilities: Record<DiagnosisDecisionChoice, number>;
};

// 結果画面で使う、choiceごとの問いかけ文言。
// 断定ではなく提案・問いかけとして表示する。
export const DECISION_PROMPT_LABELS: Record<DiagnosisDecisionChoice, string> =
  {
    KEEP: "このまま大切にする？",
    RETRY: "もう一度着てみる？",
    REBYE: "Re:bye候補として考えてみる？",
  };

// KEEP / RETRY / REBYE の定義。
// scripts/test-jev-cases.mts での検証結果をもとにした指示文。
// 「着ていない = REBYE」と短絡させず、あくまで次の行動候補の提示であって
// 最終決定ではないことを明記する。
const decisionInstructions =
  "ユーザーの服1着について、FACT（客観的な利用データ）とFEELING（本人の気持ち）を踏まえて、" +
  "次にとるべき行動の候補を1つ選んでください。これは最終決定ではなく、ユーザー自身が" +
  "着る・残す・手放すを考えるための判断材料です。着用回数が少ない、または長期間着ていない" +
  "という事実だけでREBYEを選ばないでください。ユーザーの気持ち（current_feeling, " +
  "want_to_wear_again）や、着ていない理由（not_worn_reasons、複数の場合あり）を重視してください。" +
  "not_worn_reasonsに複数の理由が含まれていても、理由の数だけでREBYEに傾けないでください。" +
  "それぞれの理由の内容と、FACT・FEELING全体を踏まえて総合的に判断してください。";

const decisionCriteria = {
  KEEP: "現在も活用している、または明確に残しておきたい理由がある",
  RETRY:
    "最近着ていなくても、愛着や再着用意欲があり、手放す前にもう一度着たり活用方法を試す価値がある",
  REBYE:
    "長期間活用されておらず、再着用意欲も低いなど、手放すことを検討する材料が揃っている（最終判断ではなく候補として）",
};

/**
 * FACT（サーバー側で計算した客観データ）とFEELING（本人の回答）を
 * Vercel AI Gateway経由でJev（typesafe-ai/jev）へ渡し、
 * KEEP / RETRY / REBYE の choice と probabilities を取得する。
 *
 * 注意: ZDR（zeroDataRetention）はまだ有効化していない。
 * プラン・Jev側の対応可否を確認してから追加する。
 */
export async function runJevDiagnosis(
  fact: DiagnosisFact,
  feeling: DiagnosisFeelingInput,
): Promise<JevDiagnosisResult> {
  const state = {
    wear_count: fact.wear_count,
    days_since_last_worn: fact.days_since_last_worn,
    days_since_purchase: fact.days_since_purchase,
    favorite: fact.favorite,
    category: fact.category,
    season: fact.season,
    current_season: fact.current_season,
    current_feeling: feeling.currentFeeling,
    want_to_wear_again: feeling.wantToWearAgain,
    not_worn_reasons: feeling.notWornReasons,
  };

  const result = await evaluate({
    model: "typesafe-ai/jev",
    state,
    questions: {
      decision: {
        type: "choice",
        instructions: decisionInstructions,
        criteria: decisionCriteria,
      },
    },
  });

  const decision = result.answers.decision;

  return {
    choice: decision.choice as DiagnosisDecisionChoice,
    probabilities: decision.probabilities as Record<
      DiagnosisDecisionChoice,
      number
    >,
  };
}
