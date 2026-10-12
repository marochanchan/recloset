// ============================================================
// 習慣化・進捗の週次集計（純粋関数。DB・UI・AIに依存しない）
//
// - 週は日本時間（Asia/Tokyo, 常にUTC+9・サマータイムなし）の
//   月曜0:00〜翌月曜0:00。範囲は開始を含み、終了を含まない
// - 見直し着数: AI診断（ai_diagnoses）とスワイプ式の見直し
//   （closet_review_decisions、skipを除く）を合わせ、同じ週の同じ服は1着
//   - AI診断はDBに保存された行（＝成功した診断）だけが渡される前提
//   - スワイプの取り消しは行が削除されるため、渡された行が「今有効な判断」
//   - 途中で終えたセッションの判断も行があれば数える
// - 着用記録: 週内の記録回数（見直しの目標・達成率には含めない）
// - 週次目標: 3・7・14着、または目標なし（null）。設定がなければ3着
//
// 将来のRe:Quest・Re:Garden・Re:Storyでも使えるよう、表示の文言はここに置かない。
// Node.jsから直接テストできるよう、他のモジュールをimportしない
// （テスト: node scripts/test-habit-progress.mts）
// ============================================================

// lib/wear-logs.ts と同じ日本時間のオフセット
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export type JstWeekRange = {
  /** 月曜0:00（日本時間）のUTC時刻。この時刻を含む */
  startUtc: Date;
  /** 翌月曜0:00（日本時間）のUTC時刻。この時刻を含まない */
  endUtc: Date;
  /** 週の初日（月曜）の日本時間の日付（YYYY-MM-DD）。週の識別に使う */
  weekStartDateKey: string;
};

/** referenceDate が属する週（日本時間の月曜0:00〜翌月曜0:00）をUTCで返す */
export function getJstWeekRangeUtc(
  referenceDate: Date = new Date(),
): JstWeekRange {
  const jstShifted = new Date(referenceDate.getTime() + JST_OFFSET_MS);
  // 日曜=0 … 土曜=6 を、月曜からの日数（月曜=0 … 日曜=6）に直す
  const daysSinceMonday = (jstShifted.getUTCDay() + 6) % 7;
  const mondayJstAsUtc = Date.UTC(
    jstShifted.getUTCFullYear(),
    jstShifted.getUTCMonth(),
    jstShifted.getUTCDate() - daysSinceMonday,
  );
  const startUtc = new Date(mondayJstAsUtc - JST_OFFSET_MS);
  return {
    startUtc,
    endUtc: new Date(startUtc.getTime() + 7 * DAY_MS),
    weekStartDateKey: new Date(mondayJstAsUtc).toISOString().slice(0, 10),
  };
}

/** ISO時刻が範囲内か（開始を含み、終了を含まない。不正な値は範囲外） */
export function isInRange(
  isoString: string,
  range: { startUtc: Date; endUtc: Date },
): boolean {
  const time = new Date(isoString).getTime();
  return (
    !Number.isNaN(time) &&
    time >= range.startUtc.getTime() &&
    time < range.endUtc.getTime()
  );
}

// ------------------------------------------------------------
// 見直し
// ------------------------------------------------------------

/** ai_diagnoses の行（必要な列だけ） */
export type AiDiagnosisRow = {
  clothing_item_id: string;
  created_at: string;
};

/** closet_review_decisions の行（必要な列だけ） */
export type SwipeDecisionRow = {
  clothing_item_id: string;
  decision: string;
  created_at: string;
};

export type ReviewActivitySource = "ai_diagnosis" | "swipe";

/** 1回の見直し（AI診断・スワイプの判断を同じ形にしたもの） */
export type ReviewActivity = {
  clothingItemId: string;
  occurredAt: string;
  source: ReviewActivitySource;
};

/**
 * AI診断とスワイプの判断を、見直しの記録としてまとめる。
 * スワイプのskipは見直しに数えないため除く。
 */
export function toReviewActivities({
  aiDiagnoses,
  swipeDecisions,
}: {
  aiDiagnoses: AiDiagnosisRow[];
  swipeDecisions: SwipeDecisionRow[];
}): ReviewActivity[] {
  return [
    ...aiDiagnoses.map((row) => ({
      clothingItemId: row.clothing_item_id,
      occurredAt: row.created_at,
      source: "ai_diagnosis" as const,
    })),
    ...swipeDecisions
      .filter((row) => row.decision !== "skip")
      .map((row) => ({
        clothingItemId: row.clothing_item_id,
        occurredAt: row.created_at,
        source: "swipe" as const,
      })),
  ];
}

/** 範囲内に見直した服のID（重複なし） */
export function getReviewedItemIds(
  activities: ReviewActivity[],
  range: { startUtc: Date; endUtc: Date },
): Set<string> {
  const ids = new Set<string>();
  for (const activity of activities) {
    if (isInRange(activity.occurredAt, range)) ids.add(activity.clothingItemId);
  }
  return ids;
}

/** 範囲内に見直した着数（同じ服は1着） */
export function countReviewedItems(
  activities: ReviewActivity[],
  range: { startUtc: Date; endUtc: Date },
): number {
  return getReviewedItemIds(activities, range).size;
}

// ------------------------------------------------------------
// 着用記録
// ------------------------------------------------------------

/** 範囲内の着用記録の回数（同じ服の記録も1回ずつ数える） */
export function countWearLogs(
  wearLogs: { worn_at: string }[],
  range: { startUtc: Date; endUtc: Date },
): number {
  return wearLogs.filter((log) => isInRange(log.worn_at, range)).length;
}

// ------------------------------------------------------------
// 週次目標
// ------------------------------------------------------------

export const WEEKLY_REVIEW_GOAL_OPTIONS = [3, 7, 14] as const;

/** 週次目標の着数。null は「目標なし」 */
export type WeeklyReviewGoal = (typeof WEEKLY_REVIEW_GOAL_OPTIONS)[number] | null;

export const DEFAULT_WEEKLY_REVIEW_GOAL: WeeklyReviewGoal = 3;

function isGoalOption(
  value: unknown,
): value is (typeof WEEKLY_REVIEW_GOAL_OPTIONS)[number] {
  return (WEEKLY_REVIEW_GOAL_OPTIONS as readonly unknown[]).includes(value);
}

/**
 * 保存された設定から週次目標を決める。
 * - 設定がない（行がない）: 初期値の3着
 * - null: 目標なし
 * - 選択肢にない値: 初期値の3着
 */
export function resolveWeeklyReviewGoal(
  setting: { weekly_review_goal: unknown } | null | undefined,
): WeeklyReviewGoal {
  if (!setting) return DEFAULT_WEEKLY_REVIEW_GOAL;
  if (setting.weekly_review_goal === null) return null;
  return isGoalOption(setting.weekly_review_goal)
    ? setting.weekly_review_goal
    : DEFAULT_WEEKLY_REVIEW_GOAL;
}

/** 設定画面のフォームで使う値。"none" は目標なし */
export const WEEKLY_REVIEW_GOAL_VALUES = ["3", "7", "14", "none"] as const;
export type WeeklyReviewGoalValue = (typeof WEEKLY_REVIEW_GOAL_VALUES)[number];

export function toWeeklyReviewGoalValue(
  goal: WeeklyReviewGoal,
): WeeklyReviewGoalValue {
  return goal === null ? "none" : (String(goal) as WeeklyReviewGoalValue);
}

/**
 * フォームから送られた値を週次目標にする（Server Actionでの検証用）。
 * "3"・"7"・"14"・"none" 以外はすべて拒否する。
 */
export function parseWeeklyReviewGoalValue(
  value: unknown,
): { ok: true; goal: WeeklyReviewGoal } | { ok: false } {
  if (value === "none") return { ok: true, goal: null };
  if (typeof value !== "string") return { ok: false };
  const goal = WEEKLY_REVIEW_GOAL_OPTIONS.find((option) => String(option) === value);
  return goal === undefined ? { ok: false } : { ok: true, goal };
}

export type WeeklyProgress = {
  /** 今週見直した着数（上限なし） */
  reviewedItemCount: number;
  /** 今週の着用記録の回数（目標・達成率には含めない） */
  wearLogCount: number;
  /** 週次目標。null は目標なし */
  goal: WeeklyReviewGoal;
  /** 表示用の進捗率（0〜1、目標を超えても1が上限）。目標なしはnull */
  progressRate: number | null;
  /** 目標を達成したか。目標なしはnull */
  achieved: boolean | null;
  /** 目標まであと何着か（達成後は0）。目標なしはnull */
  remainingToGoal: number | null;
};

export function buildWeeklyProgress({
  reviewedItemCount,
  wearLogCount,
  goal,
}: {
  reviewedItemCount: number;
  wearLogCount: number;
  goal: WeeklyReviewGoal;
}): WeeklyProgress {
  if (goal === null) {
    return {
      reviewedItemCount,
      wearLogCount,
      goal,
      progressRate: null,
      achieved: null,
      remainingToGoal: null,
    };
  }
  return {
    reviewedItemCount,
    wearLogCount,
    goal,
    progressRate: Math.min(reviewedItemCount / goal, 1),
    achieved: reviewedItemCount >= goal,
    remainingToGoal: Math.max(goal - reviewedItemCount, 0),
  };
}
