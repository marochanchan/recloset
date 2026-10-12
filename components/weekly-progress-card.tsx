import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { WeeklyGoalCelebration } from "@/components/weekly-goal-celebration";
import type { WeeklyProgress } from "@/lib/habit-progress";
import {
  getWeeklyReviewMessage,
  getWeeklyWearMessage,
  WEEKLY_REVIEW_GOAL_LOAD_ERROR_MESSAGE,
} from "@/lib/habit-progress-copy";
import Link from "next/link";

const CARD_TITLE = "今週のRe:Closet";
const GOAL_SETTINGS_HREF = "/protected/settings#weekly-review-goal";
// Closetの「今日見直す3着」（後から表示されるため、表示時にスクロールする）
const REVIEW_SUGGESTIONS_HREF = "/protected/items#review-suggestions-title";

// 2つの導線ボタン。文言が長くなっても折り返し、タップしやすい高さを保つ
const ACTION_BUTTON_CLASS = "h-auto min-h-10 whitespace-normal py-2 text-center";

// Todayの「今週のRe:Closet」。見直しの目標と着用の実績は分けて表示する。
// 「今日の3着を見る」はClosetの「今日見直す3着」へ（Todayの「今日のRe:try」とは別）
// 目標なし・目標を読み込めなかったときは、実績だけを表示し、
// 進捗バー・達成率・達成の言葉・お祝いは出さない（progress.goal が null）
export function WeeklyProgressCard({
  progress,
  weekStartDateKey,
  goalLoadFailed = false,
}: {
  progress: WeeklyProgress;
  /** 今週の初日（月曜、YYYY-MM-DD）。お祝いを週に一度にするために使う */
  weekStartDateKey: string;
  goalLoadFailed?: boolean;
}) {
  const percent =
    progress.progressRate === null ? null : Math.round(progress.progressRate * 100);

  return (
    <section aria-labelledby="weekly-progress-title">
      <Card className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h2 id="weekly-progress-title" className="text-lg font-semibold">
            {CARD_TITLE}
          </h2>
          <Link
            href={GOAL_SETTINGS_HREF}
            className="-my-1 py-1 text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
          >
            {progress.goal === null && !goalLoadFailed ? "目標を設定" : "目標を変更"}
          </Link>
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
            <p className="text-sm text-muted-foreground">見直した服</p>
            <p className="text-sm">
              <span className="text-2xl font-bold tabular-nums">
                {progress.reviewedItemCount}
              </span>
              着
              {progress.goal !== null && (
                <span className="text-muted-foreground">
                  {" "}
                  / 目標{progress.goal}着
                </span>
              )}
            </p>
          </div>
          {percent !== null && (
            <div
              role="progressbar"
              aria-label="今週の見直しの目標に対する進捗"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent}
              aria-valuetext={`目標${progress.goal}着のうち${progress.reviewedItemCount}着`}
              className="h-2 w-full overflow-hidden rounded-full bg-muted"
            >
              <div
                className="h-full rounded-full bg-primary motion-safe:transition-[width] motion-safe:duration-500"
                style={{ width: `${percent}%` }}
              />
            </div>
          )}
          {goalLoadFailed && (
            <p className="text-sm text-muted-foreground">
              {WEEKLY_REVIEW_GOAL_LOAD_ERROR_MESSAGE}
            </p>
          )}
          {/* 達成の判定はサーバーの実績。お祝いはこのブラウザで今週はじめての表示のときだけ、
              通常の言葉の代わりに表示する（目標なし・未達成・取得エラーでは常に通常の言葉） */}
          <WeeklyGoalCelebration
            achieved={progress.achieved}
            weekStartDateKey={weekStartDateKey}
          >
            <p className="break-words text-sm">{getWeeklyReviewMessage(progress)}</p>
          </WeeklyGoalCelebration>
        </div>

        <div className="flex flex-col gap-1 border-t pt-3">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3">
            <p className="text-sm text-muted-foreground">着用記録</p>
            <p className="text-sm">
              <span className="text-lg font-bold tabular-nums">
                {progress.wearLogCount}
              </span>
              回
            </p>
          </div>
          <p className="break-words text-xs text-muted-foreground">
            {getWeeklyWearMessage(progress)}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Button asChild variant="outline" size="sm" className={ACTION_BUTTON_CLASS}>
            <Link href={REVIEW_SUGGESTIONS_HREF}>今日の3着を見る</Link>
          </Button>
          <Button asChild variant="outline" size="sm" className={ACTION_BUTTON_CLASS}>
            <Link href="/protected/review">まとめて見直す</Link>
          </Button>
        </div>
      </Card>
    </section>
  );
}

// 取得に失敗したとき（0着と誤表示しない）
export function WeeklyProgressError() {
  return (
    <section aria-labelledby="weekly-progress-title">
      <Card className="flex flex-col gap-2 p-4">
        <h2 id="weekly-progress-title" className="text-lg font-semibold">
          {CARD_TITLE}
        </h2>
        <p className="text-sm text-muted-foreground">進捗を読み込めませんでした</p>
      </Card>
    </section>
  );
}
