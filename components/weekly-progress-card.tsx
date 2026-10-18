import { DoodleShirt, DoodleTag } from "@/components/doodle-icons";
import { WeeklyGoalCelebration } from "@/components/weekly-goal-celebration";
import type { WeeklyProgress } from "@/lib/habit-progress";
import {
  getWeeklyReviewMessage,
  WEEKLY_REVIEW_GOAL_LOAD_ERROR_MESSAGE,
} from "@/lib/habit-progress-copy";
import type { ReQuestProgress } from "@/lib/re-quest";
import { getActiveDaysMessage, getWeekdayLabel } from "@/lib/re-quest-copy";
import { cn } from "@/lib/utils";
import Link from "next/link";

const CARD_TITLE = "今週のRe:Closet";
const GOAL_SETTINGS_HREF = "/protected/settings#weekly-review-goal";

// Todayの「今週のRe:Closet」。今週の行動日（Re:Questの集計）と、見直しの目標・着用の実績を
// 1つにまとめて表示する。見直しの導線は Re:Quest のタイルと Today のアイコンの導線が担う。
// 目標なし・目標を読み込めなかったときは、実績だけを表示し、
// 進捗バー・達成率・達成の言葉・お祝いは出さない（progress.goal が null）。
// 行動日（week）を読み込めなかったときは、曜日の丸を出さない
export function WeeklyProgressCard({
  progress,
  weekStartDateKey,
  goalLoadFailed = false,
  week = null,
}: {
  progress: WeeklyProgress;
  /** 今週の初日（月曜、YYYY-MM-DD）。お祝いを週に一度にするために使う */
  weekStartDateKey: string;
  goalLoadFailed?: boolean;
  /** 今週の行動日（Re:Questの集計。取得できなかったときはnull） */
  week?: Pick<ReQuestProgress, "week" | "activeDaysThisWeek"> | null;
}) {
  const percent =
    progress.progressRate === null ? null : Math.round(progress.progressRate * 100);

  return (
    <section aria-labelledby="weekly-progress-title">
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h2 id="weekly-progress-title" className="text-lg font-semibold">
            {CARD_TITLE}
          </h2>
          <Link
            href={GOAL_SETTINGS_HREF}
            className="-my-2 py-2 text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
          >
            {progress.goal === null && !goalLoadFailed ? "目標を設定" : "目標を変更"}
          </Link>
        </div>

        {week && (
          <div className="flex flex-col gap-2">
            {/* 行動した日だけを塗る。行動のない日は控えめな枠だけ（否定的な印は付けない） */}
            <ol className="grid grid-cols-7 gap-1" aria-label="今週行動した日">
              {week.week.map((day, index) => (
                <li key={day.dateKey} className="flex justify-center">
                  {/* 曜日を丸の中に置き、行動した日はセージで塗る。今日は淡いピンクの輪で示す */}
                  <span
                    className={cn(
                      "flex h-9 w-9 items-center justify-center rounded-full text-xs tabular-nums",
                      day.active
                        ? "bg-primary font-medium text-primary-foreground"
                        : "border border-border bg-card text-muted-foreground",
                      day.isToday &&
                        "font-semibold ring-2 ring-blush ring-offset-2 ring-offset-background",
                    )}
                  >
                    {getWeekdayLabel(index)}
                    <span className="sr-only">
                      {day.isToday ? "（今日）" : ""}
                      {day.active ? "行動した日" : ""}
                    </span>
                  </span>
                </li>
              ))}
            </ol>
            <p className="break-words text-xs text-muted-foreground">
              {getActiveDaysMessage(week.activeDaysThisWeek)}
            </p>
          </div>
        )}

        <dl className="grid grid-cols-2 gap-2">
          <div className="flex flex-col gap-1 rounded-2xl bg-secondary/60 px-4 py-3">
            <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <DoodleTag size={16} className="text-primary" />
              見直した服
            </dt>
            <dd className="text-sm">
              <span className="text-2xl font-semibold tabular-nums">
                {progress.reviewedItemCount}
              </span>
              着
              {progress.goal !== null && (
                <span className="text-xs text-muted-foreground"> / {progress.goal}着</span>
              )}
            </dd>
            {percent !== null && (
              <div
                role="progressbar"
                aria-label="今週の見直しの目標に対する進捗"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={percent}
                aria-valuetext={`目標${progress.goal}着のうち${progress.reviewedItemCount}着`}
                className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-card"
              >
                <div
                  className="h-full rounded-full bg-primary motion-safe:transition-[width] motion-safe:duration-500"
                  style={{ width: `${percent}%` }}
                />
              </div>
            )}
          </div>
          <div className="flex flex-col gap-1 rounded-2xl bg-secondary/60 px-4 py-3">
            <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <DoodleShirt size={16} className="text-primary" />
              着用記録
            </dt>
            <dd className="text-sm">
              <span className="text-2xl font-semibold tabular-nums">
                {progress.wearLogCount}
              </span>
              回
            </dd>
          </div>
        </dl>

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
    </section>
  );
}

// 取得に失敗したとき（0着と誤表示しない）
export function WeeklyProgressError() {
  return (
    <section aria-labelledby="weekly-progress-title">
      <div className="flex flex-col gap-3">
        <h2 id="weekly-progress-title" className="text-lg font-semibold">
          {CARD_TITLE}
        </h2>
        <p className="rounded-xl bg-secondary/60 px-4 py-3 text-sm text-muted-foreground">
          進捗を読み込めませんでした
        </p>
      </div>
    </section>
  );
}
