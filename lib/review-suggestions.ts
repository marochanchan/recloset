import { isAllSeasons, normalizeSeasons } from "@/lib/clothing-options";
import { getDaysSinceLastWorn, getDaysSincePurchase } from "@/lib/wear-logs";

// ============================================================
// 今日見直す3着（完全ルールベース・純粋関数。AI・DB変更なし）
//
// クローゼットの服から、着る・残す・手放すを考えるきっかけになる服を最大3着選ぶ。
// Todayの「今日のRe:try」（今日着る服の提案）とは目的が別。
//
// - 「Re:Closetでの着用記録なし」は「長期間着ていない」とは扱わない
//   （記録を始める前から着ていた可能性があるため）。初回にまとめて登録した服も
//   候補にできるよう、登録日では除外しない。記録のない服は購入日（不明ならnull）
//   だけを手がかりに、着用状況を断定しない言い方で提案する
// - 診断した服は30日間候補から外す。statusは変更しない
// - 同じ優先度の中は「日付×服ID」の決定的な順序。同じ日は同じ結果になり、
//   日が変わると入れ替わる（毎日必ず変わることは保証しない）
// ============================================================

export const REVIEW_RULES = {
  /** これ以内に着た服は、今使っている服として外す */
  recentlyWornDays: 14,
  /** これ未満しか経っていない診断済みの服は外す */
  recentlyDiagnosedDays: 30,
  /** 着用記録がない服で、購入からこれ以上を「以前から持っている服」とする */
  longOwnedDays: 180,
  /** 最後の着用からこれ以上を「長く着ていない」とする */
  longUnwornDays: 90,
  /** 最後の着用からこれ以上を「しばらく出番がない」とする */
  unwornDays: 30,
} as const;

export const MAX_REVIEW_SUGGESTIONS = 3;

const REVIEWABLE_STATUSES = ["closet", "candidate"];

export type ReviewDecision = "KEEP" | "RETRY" | "REBYE";

export type ReviewItemInput = {
  id: string;
  title: string;
  status: string;
  seasons: string[];
  favorite: boolean;
  /** 最後の着用（Re:Closetで記録したもの）。記録なしはnull */
  lastWornAt: string | null;
  /** 購入日（YYYY-MM-DD）。不明ならnull（補完しない） */
  purchaseDate: string | null;
  /** 最新のAI診断（なければnull） */
  latestDiagnosis: { decision: ReviewDecision; createdAt: string } | null;
};

export type ReviewReasonKind =
  | "candidate"
  | "retry_follow_up"
  | "long_unworn"
  | "unworn_for_a_while"
  | "no_record_long_owned"
  | "no_record";

export type ReviewSuggestion = {
  item: ReviewItemInput;
  kind: ReviewReasonKind;
  /** 提案理由（責めず、見直すきっかけになる言い方） */
  reason: string;
  /** 今の季節に着られる服として登録されている（季節未設定はfalse） */
  inSeason: boolean;
};

// 優先度（小さいほど先に提案する）
const KIND_PRIORITY: Record<ReviewReasonKind, number> = {
  candidate: 1,
  retry_follow_up: 2,
  long_unworn: 3,
  unworn_for_a_while: 4,
  no_record_long_owned: 5,
  no_record: 6,
};

// 日付が変わると並びが入れ替わる決定的なハッシュ（FNV-1a 32bit）。
// スワイプ式の見直し（lib/closet-review.ts）の並び順にも使う
export function stableHash(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function buildReason(
  kind: ReviewReasonKind,
  daysSinceWorn: number | null,
): string {
  switch (kind) {
    case "candidate":
      return "手放し候補に入れた服。今の気持ちを確かめてみませんか？";
    case "retry_follow_up":
      return "前回「もう一度着てみる」と考えた服。その後どうでしたか？";
    case "long_unworn":
      return `最後に着てから約${Math.floor((daysSinceWorn ?? 0) / 30)}か月。今の自分に合うか見てみませんか？`;
    case "unworn_for_a_while":
      return "しばらく出番がない服。次に着る場面を考えてみませんか？";
    // 着用記録のない服は、着用状況を断定しない
    case "no_record_long_owned":
      return "以前から持っている服。今も着たいと思えますか？";
    case "no_record":
      return "クローゼットに登録した服。これからどんな場面で着たいですか？";
  }
}

/** 1着を判定し、候補なら理由の種類を、対象外ならnullを返す */
function classify(
  item: ReviewItemInput,
  now: Date,
): { kind: ReviewReasonKind; daysSinceWorn: number | null } | null {
  if (!REVIEWABLE_STATUSES.includes(item.status)) return null;

  const daysSinceWorn = getDaysSinceLastWorn(item.lastWornAt, now);
  if (daysSinceWorn !== null && daysSinceWorn <= REVIEW_RULES.recentlyWornDays) {
    return null;
  }

  const daysSinceDiagnosis = item.latestDiagnosis
    ? getDaysSinceLastWorn(item.latestDiagnosis.createdAt, now)
    : null;
  if (
    daysSinceDiagnosis !== null &&
    daysSinceDiagnosis < REVIEW_RULES.recentlyDiagnosedDays
  ) {
    return null;
  }

  if (item.status === "candidate") {
    return { kind: "candidate", daysSinceWorn };
  }

  // 前回RETRYで、その診断以降に着用記録がない
  if (
    item.latestDiagnosis?.decision === "RETRY" &&
    (item.lastWornAt === null ||
      new Date(item.lastWornAt).getTime() <
        new Date(item.latestDiagnosis.createdAt).getTime())
  ) {
    return { kind: "retry_follow_up", daysSinceWorn };
  }

  if (daysSinceWorn === null) {
    // 着用記録なし: 購入日だけを手がかりにする（不明なら no_record）
    const daysSincePurchase = getDaysSincePurchase(item.purchaseDate, now);
    return {
      kind:
        daysSincePurchase !== null &&
        daysSincePurchase >= REVIEW_RULES.longOwnedDays
          ? "no_record_long_owned"
          : "no_record",
      daysSinceWorn,
    };
  }
  if (daysSinceWorn >= REVIEW_RULES.longUnwornDays) {
    return { kind: "long_unworn", daysSinceWorn };
  }
  if (daysSinceWorn >= REVIEW_RULES.unwornDays) {
    return { kind: "unworn_for_a_while", daysSinceWorn };
  }
  // 15〜29日前に着た服は、まだ見直す時期ではない
  return null;
}

/** 今日見直す3着の対象外（最近着た・診断した等）の服の優先度。候補より後に並べる */
export const LOWEST_REVIEW_PRIORITY = Math.max(...Object.values(KIND_PRIORITY)) + 1;

/**
 * 見直しのきっかけとしての優先度（小さいほど先）。今日見直す3着と同じ判定を使い、
 * 対象外の服は除外せず LOWEST_REVIEW_PRIORITY にする（スワイプ式の見直しで使う）
 */
export function getReviewPriority(item: ReviewItemInput, now: Date): number {
  const result = classify(item, now);
  return result ? KIND_PRIORITY[result.kind] : LOWEST_REVIEW_PRIORITY;
}

/**
 * 今日見直す服を最大 limit 着選ぶ。
 * 並び順: 優先度 → 今の季節に合う（季節未設定も合う側） → お気に入りでない →
 *         日付×服IDの決定的な順序
 */
export function selectReviewSuggestions({
  items,
  now,
  dateKey,
  currentSeason,
  limit = MAX_REVIEW_SUGGESTIONS,
}: {
  items: ReviewItemInput[];
  now: Date;
  /** 日本時間の今日（YYYY-MM-DD）。同じ日なら同じ結果になる */
  dateKey: string;
  currentSeason: "spring" | "summer" | "autumn" | "winter";
  limit?: number;
}): ReviewSuggestion[] {
  const scored = items.flatMap((item) => {
    const result = classify(item, now);
    if (!result) return [];
    const seasons = normalizeSeasons(item.seasons);
    const inSeason =
      seasons.length > 0 &&
      (isAllSeasons(seasons) || seasons.includes(currentSeason));
    // 季節未設定は除外せず、季節が合う側として扱う
    const seasonFits = seasons.length === 0 || inSeason;
    return [
      {
        suggestion: {
          item,
          kind: result.kind,
          reason: buildReason(result.kind, result.daysSinceWorn),
          inSeason,
        },
        sortKey: [
          KIND_PRIORITY[result.kind],
          seasonFits ? 0 : 1,
          item.favorite ? 1 : 0,
          stableHash(`${dateKey}:${item.id}`),
        ],
      },
    ];
  });

  scored.sort((a, b) => {
    for (let i = 0; i < a.sortKey.length; i++) {
      if (a.sortKey[i] !== b.sortKey[i]) return a.sortKey[i] - b.sortKey[i];
    }
    return 0;
  });

  return scored.slice(0, limit).map((entry) => entry.suggestion);
}
