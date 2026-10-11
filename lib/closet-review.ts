import {
  getReviewPriority,
  stableHash,
  type ReviewItemInput,
} from "@/lib/review-suggestions";

// ============================================================
// スワイプ式の見直しセッション（完全ルールベース・純粋関数。AIは使わない）
//
// - 1セッション最大10着。対象はクローゼット・手放し候補の服（写真だけ登録した服も含む）。
//   出品中・売却済みは対象外。登録日が新しいだけでは除外しない
// - 並び順: スワイプで最後に見直した日が古い順（一度も見直していない服が先）
//   → 今日見直す3着と同じ優先度 → 日付×服IDの決定的な順序
// - 判断は履歴（closet_review_decisions）に残すだけで、服の status は変えない
// - skip は「見直した着数」に数えない
// ============================================================

export const MAX_REVIEW_SESSION_ITEMS = 10;

/** セッションの対象にする服の状態（今日見直す3着と同じ） */
export const REVIEW_SESSION_STATUSES = ["closet", "candidate"] as const;

export const REVIEW_SESSION_DECISIONS = [
  "keep",
  "unsure",
  "let_go_candidate",
  "skip",
] as const;

export type ReviewSessionDecision = (typeof REVIEW_SESSION_DECISIONS)[number];

export const REVIEW_SESSION_DECISION_LABELS: Record<
  ReviewSessionDecision,
  string
> = {
  keep: "残す",
  unsure: "迷う",
  let_go_candidate: "手放し候補",
  skip: "スキップ",
};

export function isReviewSessionDecision(
  value: unknown,
): value is ReviewSessionDecision {
  return (REVIEW_SESSION_DECISIONS as readonly unknown[]).includes(value);
}

export function isReviewSessionStatus(status: string): boolean {
  return (REVIEW_SESSION_STATUSES as readonly string[]).includes(status);
}

/**
 * セッションで見直す服のIDを、見せる順に最大 limit 着選ぶ。
 * lastReviewedAtByItem: 服ID → スワイプで最後に判断した日時（skipを除く）
 */
export function selectReviewSessionItems({
  items,
  lastReviewedAtByItem,
  now,
  dateKey,
  limit = MAX_REVIEW_SESSION_ITEMS,
}: {
  items: ReviewItemInput[];
  lastReviewedAtByItem: Map<string, string>;
  now: Date;
  /** 日本時間の今日（YYYY-MM-DD）。同じ日なら同じ並びになる */
  dateKey: string;
  limit?: number;
}): string[] {
  return items
    .filter((item) => isReviewSessionStatus(item.status))
    .map((item) => {
      const lastReviewedAt = lastReviewedAtByItem.get(item.id);
      return {
        id: item.id,
        sortKey: [
          // 一度も見直していない服を先に、その後は古い順
          lastReviewedAt ? new Date(lastReviewedAt).getTime() : -Infinity,
          getReviewPriority(item, now),
          stableHash(`${dateKey}:review-session:${item.id}`),
        ],
      };
    })
    .sort((a, b) => {
      for (let i = 0; i < a.sortKey.length; i++) {
        if (a.sortKey[i] !== b.sortKey[i]) {
          return a.sortKey[i] < b.sortKey[i] ? -1 : 1;
        }
      }
      return 0;
    })
    .slice(0, limit)
    .map((entry) => entry.id);
}

export type ReviewSessionSummary = {
  /** 見直した着数（スキップを除く） */
  reviewed: number;
  keep: number;
  unsure: number;
  letGoCandidate: number;
  skip: number;
};

export function summarizeReviewDecisions(
  decisions: { decision: string }[],
): ReviewSessionSummary {
  const summary: ReviewSessionSummary = {
    reviewed: 0,
    keep: 0,
    unsure: 0,
    letGoCandidate: 0,
    skip: 0,
  };
  for (const { decision } of decisions) {
    if (decision === "keep") summary.keep++;
    else if (decision === "unsure") summary.unsure++;
    else if (decision === "let_go_candidate") summary.letGoCandidate++;
    else if (decision === "skip") summary.skip++;
  }
  summary.reviewed = summary.keep + summary.unsure + summary.letGoCandidate;
  return summary;
}
