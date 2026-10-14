import {
  isActiveDay,
  summarizeActivitiesByDay,
  toJstDateKey,
  type ClosetActivity,
  type DailyActivitySummary,
} from "@/lib/closet-activity";
import type { JstWeekRange } from "@/lib/habit-progress";

// ============================================================
// Re:Quest（今日のクエスト。純粋関数。DB・UI・AIに依存しない）
//
// - 今日のクエストは3種類（登録・見直し・着用）。どれか1つできたら今日は達成
//   （「今日は1つでOK」。大量に登録しても、達成は1回）
// - 達成はふだんの記録から自動で判定する（チェックの入力はさせない）
// - 今週の行動日数（月曜〜日曜のうち、何か1つでも行動した日）を数える
// - 連続日数・ポイント・ランキング・ペナルティは扱わない
// - 週次の見直し目標（今週のRe:Closet）とは別。そちらは見直し着数の目標、
//   こちらは「今日、何か1つ」の行動
// 表示の文言は lib/re-quest-copy.ts に置く
// ============================================================

/** 表示する順番 */
export const DAILY_QUEST_KINDS = ["register", "review", "wear"] as const;

export type DailyQuestKind = (typeof DAILY_QUEST_KINDS)[number];

export type DailyQuest = {
  kind: DailyQuestKind;
  /** 今日できたか */
  done: boolean;
  /** 今日の着数・回数（登録・見直しは着数、着用は回数） */
  count: number;
};

export type ReQuestProgress = {
  /** 今日（日本時間、YYYY-MM-DD） */
  todayDateKey: string;
  quests: DailyQuest[];
  /** 今日のクエストを1つ以上達成したか */
  achievedToday: boolean;
  /** 今週（月曜〜日曜）、何か1つでも行動した日数 */
  activeDaysThisWeek: number;
  /** 今週の7日分（月曜→日曜）。行動した日の表示に使う */
  week: { dateKey: string; active: boolean; isToday: boolean }[];
};

function countOf(summary: DailyActivitySummary, kind: DailyQuestKind): number {
  switch (kind) {
    case "register":
      return summary.registeredItemCount;
    case "review":
      return summary.reviewedItemCount;
    case "wear":
      return summary.wearLogCount;
  }
}

/** 今週の行動から、今日のクエストと今週の行動日数を作る */
export function buildReQuestProgress({
  activities,
  range,
  now,
}: {
  activities: ClosetActivity[];
  /** now が属する週（lib/habit-progress.ts の getJstWeekRangeUtc） */
  range: JstWeekRange;
  now: Date;
}): ReQuestProgress {
  const todayDateKey = toJstDateKey(now.toISOString()) ?? "";
  const days = summarizeActivitiesByDay(activities, range);
  const today = days.find((day) => day.dateKey === todayDateKey) ?? {
    dateKey: todayDateKey,
    registeredItemCount: 0,
    reviewedItemCount: 0,
    wearLogCount: 0,
  };

  const quests = DAILY_QUEST_KINDS.map((kind) => {
    const count = countOf(today, kind);
    return { kind, done: count > 0, count };
  });

  return {
    todayDateKey,
    quests,
    achievedToday: quests.some((quest) => quest.done),
    activeDaysThisWeek: days.filter(isActiveDay).length,
    week: days.map((day) => ({
      dateKey: day.dateKey,
      active: isActiveDay(day),
      isToday: day.dateKey === todayDateKey,
    })),
  };
}

// ------------------------------------------------------------
// 達成の演出（同じ日に一度だけ）
// ------------------------------------------------------------

export const RE_QUEST_CELEBRATION_STORAGE_KEY = "recloset:re-quest-celebrated-date";

/** localStorage のうち使う部分だけ（テストで差し替えられるようにする） */
export type ReQuestCelebrationStorage = Pick<Storage, "getItem" | "setItem">;

/**
 * 今回、達成の演出を表示するかを決め、表示する場合は表示済みとして記録する。
 * - 今日達成していなければ表示しない
 * - 同じ日に表示済みなら表示しない
 * - storage が使えない・読み書きに失敗した場合は表示しない
 */
export function claimReQuestCelebration({
  achievedToday,
  todayDateKey,
  storage,
}: {
  achievedToday: boolean;
  todayDateKey: string;
  storage: ReQuestCelebrationStorage | null;
}): boolean {
  if (!achievedToday || !todayDateKey || !storage) return false;
  try {
    if (storage.getItem(RE_QUEST_CELEBRATION_STORAGE_KEY) === todayDateKey) {
      return false;
    }
    storage.setItem(RE_QUEST_CELEBRATION_STORAGE_KEY, todayDateKey);
    return true;
  } catch {
    return false;
  }
}
