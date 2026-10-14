import type { DailyQuestKind, ReQuestProgress } from "@/lib/re-quest";

// ============================================================
// Re:Quest の表示文言（集計は lib/re-quest.ts）
// - 「今日は1つでOK」。できなかった日・行動のない日を否定する言葉は使わない
// - 手放した数や量を成果として強調しない
// ============================================================

export const RE_QUEST_CARD_TITLE = "今日のRe:Quest";

export const RE_QUEST_LEAD = "今日は1つでOK。できそうなものから気軽にどうぞ。";

export const RE_QUEST_LOAD_ERROR_MESSAGE = "今日のクエストを読み込めませんでした";

export const RE_QUEST_CELEBRATION_MESSAGE = "今日のクエスト、達成しました！";

export const DAILY_QUEST_COPY: Record<
  DailyQuestKind,
  { label: string; href: string; doneLabel: (count: number) => string }
> = {
  register: {
    label: "服を1着登録する",
    href: "/protected/items/new",
    doneLabel: (count) => `今日${count}着登録しました`,
  },
  review: {
    label: "服を1着見直す",
    // Closetの「今日見直す3着」（WeeklyProgressCardと同じ導線）
    href: "/protected/items#review-suggestions-title",
    doneLabel: (count) => `今日${count}着見直しました`,
  },
  wear: {
    label: "着た服を1件記録する",
    // 着用記録は服の詳細ページから。一覧から着た服を選ぶ
    href: "/protected/items",
    doneLabel: (count) => `今日${count}件記録しました`,
  },
};

/** カード上部の言葉 */
export function getReQuestMessage(progress: ReQuestProgress): string {
  return progress.achievedToday
    ? "今日のクエスト達成！それだけで十分です。"
    : RE_QUEST_LEAD;
}

/** 今週の行動日数の言葉（0日でも責めない） */
export function getActiveDaysMessage(activeDays: number): string {
  if (activeDays === 0) return "今週はここから。どの日からでも始められます。";
  return `今週は${activeDays}日、服と向き合いました。`;
}

const WEEKDAY_LABELS = ["月", "火", "水", "木", "金", "土", "日"] as const;

/** 週の何日目（0=月曜）の曜日 */
export function getWeekdayLabel(index: number): string {
  return WEEKDAY_LABELS[index] ?? "";
}
