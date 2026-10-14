import { ReQuestCelebration } from "@/components/re-quest-celebration";
import { Card } from "@/components/ui/card";
import type { ReQuestProgress } from "@/lib/re-quest";
import {
  DAILY_QUEST_COPY,
  getActiveDaysMessage,
  getReQuestMessage,
  getWeekdayLabel,
  RE_QUEST_CARD_TITLE,
  RE_QUEST_LOAD_ERROR_MESSAGE,
} from "@/lib/re-quest-copy";
import { cn } from "@/lib/utils";
import { CheckCircle2, ChevronRight, Circle } from "lucide-react";
import Link from "next/link";

// Todayの「今日のRe:Quest」。今日、何か1つ行動できたかを見せる
// （週の見直し目標は「今週のRe:Closet」＝WeeklyProgressCardが担当する）。
// 達成はふだんの記録から自動で判定する。できていないクエストは中立の表示にして、責めない
export function ReQuestCard({ progress }: { progress: ReQuestProgress }) {
  return (
    <section aria-labelledby="re-quest-title">
      <Card className="flex flex-col gap-3 p-4">
        <div className="flex flex-col gap-1">
          <h2 id="re-quest-title" className="text-lg font-semibold">
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
                    "flex min-h-12 items-center gap-3 rounded-lg border px-3 py-2 text-sm transition-colors hover:bg-accent",
                    quest.done && "border-primary/40 bg-primary/5",
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

        <div className="flex flex-col gap-2 border-t pt-3">
          <p className="break-words text-sm">
            {getActiveDaysMessage(progress.activeDaysThisWeek)}
          </p>
          {/* 行動した日だけを塗る。行動のない日は控えめな枠だけ（否定的な印は付けない） */}
          <ol className="grid grid-cols-7 gap-1" aria-label="今週行動した日">
            {progress.week.map((day, index) => (
              <li
                key={day.dateKey}
                className="flex flex-col items-center gap-1 text-[11px] text-muted-foreground"
              >
                <span
                  className={cn(
                    "h-3 w-3 rounded-full border",
                    day.active ? "border-primary bg-primary" : "border-muted-foreground/30",
                    day.isToday && "ring-2 ring-primary/30 ring-offset-1 ring-offset-background",
                  )}
                  aria-hidden="true"
                />
                <span className={cn(day.isToday && "font-semibold text-foreground")}>
                  {getWeekdayLabel(index)}
                </span>
                <span className="sr-only">{day.active ? "行動した日" : ""}</span>
              </li>
            ))}
          </ol>
        </div>
      </Card>
    </section>
  );
}

// 取得に失敗したとき（未達成と誤表示しない）
export function ReQuestError() {
  return (
    <section aria-labelledby="re-quest-title">
      <Card className="flex flex-col gap-2 p-4">
        <h2 id="re-quest-title" className="text-lg font-semibold">
          {RE_QUEST_CARD_TITLE}
        </h2>
        <p className="text-sm text-muted-foreground">{RE_QUEST_LOAD_ERROR_MESSAGE}</p>
      </Card>
    </section>
  );
}
