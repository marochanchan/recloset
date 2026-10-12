import {
  toWeeklyReviewGoalValue,
  type WeeklyProgress,
  type WeeklyReviewGoal,
  type WeeklyReviewGoalValue,
} from "@/lib/habit-progress";

// ============================================================
// 週次進捗の表示用の言葉（集計は lib/habit-progress.ts）
// - 未達成を責めない。手放した着数だけを評価しない
// - 着用の記録も、服と過ごした実績として肯定的に伝える
// ============================================================

/** 見直しの状態に応じた言葉 */
export function getWeeklyReviewMessage(progress: WeeklyProgress): string {
  if (progress.reviewedItemCount === 0) {
    return "今週はどの服から見直してみる？";
  }
  if (progress.achieved) {
    return "今週の目標達成！服と向き合う時間をつくれたね。";
  }
  if (progress.goal === null) {
    return `今週は${progress.reviewedItemCount}着と向き合えたね。`;
  }
  return "少しずつ、服と向き合えているね。";
}

/** 着用記録の言葉（目標とは別に、実績として伝える） */
export function getWeeklyWearMessage(progress: WeeklyProgress): string {
  if (progress.wearLogCount === 0) {
    return "着た日は、服の詳細から記録できます。";
  }
  return `今週は${progress.wearLogCount}回、服を着た記録があります。`;
}

// ------------------------------------------------------------
// 週次目標の選択肢（設定画面・Today）
// ------------------------------------------------------------

export type WeeklyReviewGoalChoice = {
  value: WeeklyReviewGoalValue;
  /** 例: 週3着 */
  label: string;
  /** 例: ゆっくりコース */
  description: string;
};

export const WEEKLY_REVIEW_GOAL_CHOICES: readonly WeeklyReviewGoalChoice[] = [
  { value: "3", label: "週3着", description: "ゆっくりコース" },
  { value: "7", label: "週7着", description: "コツコツコース" },
  { value: "14", label: "週14着", description: "しっかりコース" },
  { value: "none", label: "目標なし", description: "自分のペースで記録する" },
];

/** 目標の表示名（例: 「週7着（コツコツコース）」「目標なし（自分のペースで記録する）」） */
export function formatWeeklyReviewGoal(goal: WeeklyReviewGoal): string {
  const value = toWeeklyReviewGoalValue(goal);
  const choice = WEEKLY_REVIEW_GOAL_CHOICES.find((c) => c.value === value);
  return choice ? `${choice.label}（${choice.description}）` : "";
}

/** 目標を読み込めなかったとき（3着に戻したように見せない） */
export const WEEKLY_REVIEW_GOAL_LOAD_ERROR_MESSAGE = "目標を読み込めませんでした";
