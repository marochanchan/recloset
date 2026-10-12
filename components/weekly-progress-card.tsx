import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { WeeklyProgress } from "@/lib/habit-progress";
import {
  getWeeklyReviewMessage,
  getWeeklyWearMessage,
  WEEKLY_REVIEW_GOAL_LOAD_ERROR_MESSAGE,
} from "@/lib/habit-progress-copy";
import Link from "next/link";

const CARD_TITLE = "今週のRe:Closet";
const GOAL_SETTINGS_HREF = "/protected/settings#weekly-review-goal";

// Todayの「今週のRe:Closet」。見直しの目標と着用の実績は分けて表示する。
// 「今日の3着を見る」はClosetの「今日見直す3着」へ（Todayの「今日のRe:try」とは別）
// 目標なし・目標を読み込めなかったときは、実績だけを表示し、
// 進捗バー・達成率・達成の言葉は出さない（progress.goal が null）
export function WeeklyProgressCard({
  progress,
  goalLoadFailed = false,
}: {
  progress: WeeklyProgress;
  goalLoadFailed?: boolean;
}) {
  const percent =
    progress.progressRate === null ? null : Math.round(progress.progressRate * 100);

  return (
    <section aria-labelledby="weekly-progress-title">
      <Card className="flex flex-col gap-3 p-4">
        <div className="flex items-baseline justify-between gap-2">
          <h2 id="weekly-progress-title" className="text-lg font-semibold">
            {CARD_TITLE}
          </h2>
          <Link
            href={GOAL_SETTINGS_HREF}
            className="shrink-0 text-xs text-muted-foreground underline underline-offset-4"
          >
            {progress.goal === null && !goalLoadFailed ? "目標を設定" : "目標を変更"}
          </Link>
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-sm text-muted-foreground">見直した服</p>
            <p className="text-sm">
              <span className="text-2xl font-bold">
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
              className="h-2 w-full overflow-hidden rounded-full bg-muted"
            >
              <div className="h-full bg-primary" style={{ width: `${percent}%` }} />
            </div>
          )}
          {goalLoadFailed && (
            <p className="text-sm text-muted-foreground">
              {WEEKLY_REVIEW_GOAL_LOAD_ERROR_MESSAGE}
            </p>
          )}
          <p className="text-sm">{getWeeklyReviewMessage(progress)}</p>
        </div>

        <div className="flex items-baseline justify-between gap-2 border-t pt-3">
          <p className="text-sm text-muted-foreground">着用記録</p>
          <p className="text-sm">
            <span className="text-lg font-bold">{progress.wearLogCount}</span>回
          </p>
        </div>
        <p className="-mt-2 text-xs text-muted-foreground">
          {getWeeklyWearMessage(progress)}
        </p>

        <div className="grid grid-cols-2 gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href="/protected/items#review-suggestions-title">
              今日の3着を見る
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm">
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
