import { ReQuestCelebration } from "@/components/re-quest-celebration";
import type { ReQuestProgress } from "@/lib/re-quest";
import {
  DAILY_QUEST_COPY,
  getActiveDaysMessage,
  getReQuestMessage,
  getWeekdayLabel,
  RE_QUEST_CARD_TITLE,
  RE_QUEST_GARDEN_NOTE,
  RE_QUEST_LOAD_ERROR_MESSAGE,
} from "@/lib/re-quest-copy";
import { cn } from "@/lib/utils";
import { CheckCircle2, ChevronRight, Circle, Sprout } from "lucide-react";
import Link from "next/link";

// Todayの「今日のRe:Quest」。今日、何か1つ行動できたかを見せる
// （週の見直し目標は「今週のRe:Closet」＝WeeklyProgressCardが担当する）。
// 達成はふだんの記録から自動で判定する。できていないクエストは中立の表示にして、責めない。
// 枠で囲まず、クエストの行と今週の行動日だけを並べる
export function ReQuestCard({ progress }: { progress: ReQuestProgress }) {
  return (
    <section aria-labelledby="re-quest-title">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 id="re-quest-title" className="text-lg font-bold">
            {RE_QUEST_CARD_TITLE}
          </h2>
          <ReQuestCelebration
            achievedToday={progress.achievedToday}
            todayDateKey={progress.todayDateKey}
          >
            <p className="break-words text-sm text-muted-foreground">
              {getReQuestMessage(progress)}
            </p>
          </ReQuestCelebration>
        </div>

        <ul className="flex flex-col gap-2">
          {progress.quests.map((quest) => {
            const copy = DAILY_QUEST_COPY[quest.kind];
            const Icon = quest.done ? CheckCircle2 : Circle;
            return (
              <li key={quest.kind}>
                <Link
                  href={copy.href}
                  className={cn(
                    "flex min-h-12 items-center gap-3 rounded-xl px-3.5 py-2 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                    quest.done
                      ? "bg-primary/10 hover:bg-primary/15"
                      : "bg-secondary/70 hover:bg-accent active:bg-accent",
                  )}
                >
                  <Icon
                    className={cn(
                      "h-5 w-5 shrink-0",
                      quest.done ? "text-primary" : "text-muted-foreground",
                    )}
                    aria-hidden="true"
                  />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="font-medium">{copy.label}</span>
                    {quest.done && (
                      <span className="text-xs text-muted-foreground">
                        {copy.doneLabel(quest.count)}
                      </span>
                    )}
                  </span>
                  <span className="sr-only">{quest.done ? "（達成）" : ""}</span>
                  <ChevronRight
                    className="h-4 w-4 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                </Link>
              </li>
            );
          })}
        </ul>

        <p className="flex items-center gap-1.5 break-words text-xs text-muted-foreground">
          <Sprout className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {RE_QUEST_GARDEN_NOTE}
        </p>

        <div className="flex flex-col gap-2.5 pt-1">
          <p className="break-words text-sm">
            {getActiveDaysMessage(progress.activeDaysThisWeek)}
          </p>
          {/* 行動した日だけを塗る。行動のない日は控えめな枠だけ（否定的な印は付けない） */}
          <ol className="grid grid-cols-7 gap-1" aria-label="今週行動した日">
            {progress.week.map((day, index) => (
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
        </div>
      </div>
    </section>
  );
}

// 取得に失敗したとき（未達成と誤表示しない）
export function ReQuestError() {
  return (
    <section aria-labelledby="re-quest-title">
      <div className="flex flex-col gap-3">
        <h2 id="re-quest-title" className="text-lg font-bold">
          {RE_QUEST_CARD_TITLE}
        </h2>
        <p className="rounded-xl bg-secondary/60 px-4 py-3 text-sm text-muted-foreground">
          {RE_QUEST_LOAD_ERROR_MESSAGE}
        </p>
      </div>
    </section>
  );
}
