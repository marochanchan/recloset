import {
  CURRENT_FEELING_OPTIONS,
  NOT_WORN_REASON_OPTIONS,
  WANT_TO_WEAR_AGAIN_OPTIONS,
  type DiagnosisDecisionChoice,
  type DiagnosisFact,
  type DiagnosisFeelingInput,
} from "@/lib/ai-diagnosis";
import { getRecentWornBucket, type RecentWornBucket } from "@/lib/next-action";

// ============================================================
// 診断結果の表示用ラベルと「判断のヒント」
//
// 判断のヒントは、Jevへ渡したFACT/FEELINGのうち、今回の診断タイプに
// 関係が深く、ユーザーが理解しやすいものをルールベースで2〜4件選んだもの。
// Jevが文章を生成しているわけではなく、新しい推論も行わない
// （保存済みFACT/FEELINGから確実に言えることだけを並べる）。
// ============================================================

// 診断タイプの表示用ラベル。clothing_items.statusとは別概念。
// 結果画面のバッジと、Geminiへ渡す「診断の向き」の両方で使う。
export const DIAGNOSIS_TYPE_LABELS: Record<
  DiagnosisDecisionChoice,
  { badge: string; caption: string }
> = {
  KEEP: { badge: "KEEP", caption: "このまま持っておく" },
  RETRY: { badge: "RE:TRY", caption: "もう一度試してみる" },
  REBYE: { badge: "RE:BYE", caption: "手放す方向で考えてみる" },
};

// 最後の着用記録の目安（next-actionと同じバケットを使い、数値はそのまま出さない）
export const LAST_WORN_LABELS: Record<RecentWornBucket, string> = {
  recently_worn: "1週間以内",
  normal: "2か月以内",
  long_unworn: "2か月以上前",
  never_recorded: "まだない",
};

const LAST_WORN_HINTS: Record<RecentWornBucket, string> = {
  recently_worn: "この1週間以内に着た記録がある",
  normal: "最後に着た記録は2か月以内",
  long_unworn: "最後に着た記録から2か月以上たっている",
  never_recorded: "Re:Closetでの着用記録はまだない",
};

function findLabel<T extends string>(
  options: readonly { value: T; label: string }[],
  value: T,
): string {
  return options.find((option) => option.value === value)?.label ?? value;
}

type HintKey = "lastWorn" | "feeling" | "wantAgain" | "reasons" | "favorite";

// 診断タイプごとに、どの材料を優先して見せるか
// （KEEP: 気持ち中心 / RETRY: 再着用意欲と理由中心 / REBYE: 着用状況と気持ち中心）
const HINT_ORDER: Record<DiagnosisDecisionChoice, HintKey[]> = {
  KEEP: ["feeling", "wantAgain", "favorite", "lastWorn"],
  RETRY: ["wantAgain", "reasons", "lastWorn", "favorite"],
  REBYE: ["lastWorn", "wantAgain", "feeling", "reasons"],
};

const MAX_HINTS = 4;

/**
 * 「判断のヒント」を2〜4件組み立てる純粋関数。
 * お気に入りは登録している場合だけ候補になる（未登録は判断材料として示さない）。
 */
export function buildDecisionHints(
  decision: DiagnosisDecisionChoice,
  fact: DiagnosisFact,
  feeling: DiagnosisFeelingInput,
): string[] {
  const reasonLabels = feeling.notWornReasons
    .map((reason) => `「${findLabel(NOT_WORN_REASON_OPTIONS, reason)}」`)
    .join("");

  const hints: Record<HintKey, string | null> = {
    lastWorn: LAST_WORN_HINTS[getRecentWornBucket(fact.days_since_last_worn)],
    feeling: `今の気持ちは「${findLabel(CURRENT_FEELING_OPTIONS, feeling.currentFeeling)}」`,
    wantAgain: `また着たいかは「${findLabel(WANT_TO_WEAR_AGAIN_OPTIONS, feeling.wantToWearAgain)}」`,
    reasons: reasonLabels ? `着ていない理由は${reasonLabels}` : null,
    favorite: fact.favorite ? "お気に入りに登録している" : null,
  };

  return HINT_ORDER[decision]
    .map((key) => hints[key])
    .filter((hint): hint is string => hint !== null)
    .slice(0, MAX_HINTS);
}
