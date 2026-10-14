import {
  isInRange,
  type JstWeekRange,
  type ReviewActivity,
} from "@/lib/habit-progress";

// ============================================================
// クローゼットでの行動（登録・見直し・着用）を同じ形で扱う（純粋関数。DB・UI・AIに依存しない）
//
// - 既存の記録から作る。新しい行動ログのテーブルは使わない（ユーザーに二重入力させない）
//   - 登録: clothing_items.created_at
//   - 見直し: AI診断・スワイプの判断（lib/habit-progress.ts の ReviewActivity。skipは除外済み）
//   - 着用: wear_logs.worn_at
// - 日付は日本時間（Asia/Tokyo, 常にUTC+9・サマータイムなし）。週は lib/habit-progress.ts と同じ
// - 記録が削除・変更されると集計も変わる（服を削除すると、その服の着用・見直しの記録も消える）
//
// Re:Quest・Re:Garden・Re:Storyで共通に使う。表示の文言はここに置かない。
// - organize（整理: 仕分け・手放し候補）・circulate（循環: 出品中・売却済み）は、
//   行動履歴（closet_activity_events、migration 019）にだけある種類。
//   Re:Quest の日ごとの集計（summarizeActivitiesByDay）には含めない
// ============================================================

// lib/habit-progress.ts・lib/wear-logs.ts と同じ日本時間のオフセット
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export const CLOSET_ACTIVITY_KINDS = [
  "register",
  "review",
  "wear",
  "organize",
  "circulate",
] as const;

export type ClosetActivityKind = (typeof CLOSET_ACTIVITY_KINDS)[number];

/** 1回の行動 */
export type ClosetActivity = {
  kind: ClosetActivityKind;
  clothingItemId: string;
  /** 行動した時刻（ISO文字列） */
  occurredAt: string;
};

/** 既存の記録を ClosetActivity にまとめる */
export function toClosetActivities({
  registeredItems,
  reviewActivities,
  wearLogs,
}: {
  /** clothing_items の行（必要な列だけ） */
  registeredItems: { id: string; created_at: string }[];
  reviewActivities: ReviewActivity[];
  /** wear_logs の行（必要な列だけ） */
  wearLogs: { clothing_item_id: string; worn_at: string }[];
}): ClosetActivity[] {
  return [
    ...registeredItems.map((item) => ({
      kind: "register" as const,
      clothingItemId: item.id,
      occurredAt: item.created_at,
    })),
    ...reviewActivities.map((activity) => ({
      kind: "review" as const,
      clothingItemId: activity.clothingItemId,
      occurredAt: activity.occurredAt,
    })),
    ...wearLogs.map((log) => ({
      kind: "wear" as const,
      clothingItemId: log.clothing_item_id,
      occurredAt: log.worn_at,
    })),
  ];
}

/** ISO時刻の日本時間の日付（YYYY-MM-DD）。不正な値はnull */
export function toJstDateKey(isoString: string): string | null {
  const time = new Date(isoString).getTime();
  if (Number.isNaN(time)) return null;
  return new Date(time + JST_OFFSET_MS).toISOString().slice(0, 10);
}

/** 週の7日分の日付（月曜→日曜、YYYY-MM-DD） */
export function getWeekDateKeys(range: JstWeekRange): string[] {
  return Array.from({ length: 7 }, (_, index) =>
    new Date(range.startUtc.getTime() + index * DAY_MS + JST_OFFSET_MS)
      .toISOString()
      .slice(0, 10),
  );
}

/** 1日の行動のまとめ */
export type DailyActivitySummary = {
  /** 日本時間の日付（YYYY-MM-DD） */
  dateKey: string;
  /** 登録した着数 */
  registeredItemCount: number;
  /** 見直した着数（同じ日の同じ服は1着） */
  reviewedItemCount: number;
  /** 着用記録の回数 */
  wearLogCount: number;
};

/** その日に何か1つでも行動したか */
export function isActiveDay(summary: DailyActivitySummary): boolean {
  return (
    summary.registeredItemCount > 0 ||
    summary.reviewedItemCount > 0 ||
    summary.wearLogCount > 0
  );
}

/**
 * 週の行動を日ごとにまとめる（月曜→日曜の7日分。行動がない日も0で返す）。
 * 範囲外・不正な時刻の行動は数えない。
 * 登録・見直し・着用だけを数え、整理・循環は数えない（見直しなどに混ぜない）
 */
export function summarizeActivitiesByDay(
  activities: ClosetActivity[],
  range: JstWeekRange,
): DailyActivitySummary[] {
  const registered = new Map<string, Set<string>>();
  const reviewed = new Map<string, Set<string>>();
  const wearCount = new Map<string, number>();

  for (const activity of activities) {
    if (!isInRange(activity.occurredAt, range)) continue;
    const dateKey = toJstDateKey(activity.occurredAt);
    if (!dateKey) continue;
    if (activity.kind === "wear") {
      wearCount.set(dateKey, (wearCount.get(dateKey) ?? 0) + 1);
      continue;
    }
    let byDay: Map<string, Set<string>>;
    if (activity.kind === "register") byDay = registered;
    else if (activity.kind === "review") byDay = reviewed;
    else continue;
    const ids = byDay.get(dateKey) ?? new Set<string>();
    ids.add(activity.clothingItemId);
    byDay.set(dateKey, ids);
  }

  return getWeekDateKeys(range).map((dateKey) => ({
    dateKey,
    registeredItemCount: registered.get(dateKey)?.size ?? 0,
    reviewedItemCount: reviewed.get(dateKey)?.size ?? 0,
    wearLogCount: wearCount.get(dateKey) ?? 0,
  }));
}
