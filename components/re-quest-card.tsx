import { DoodleHangerPlus, DoodleShirt, DoodleTag } from "@/components/doodle-icons";
import { ReQuestCelebration } from "@/components/re-quest-celebration";
import type { DailyQuestKind, ReQuestProgress } from "@/lib/re-quest";
import {
  DAILY_QUEST_COPY,
  RE_QUEST_CARD_TITLE,
  RE_QUEST_LOAD_ERROR_MESSAGE,
} from "@/lib/re-quest-copy";
import { cn } from "@/lib/utils";
import { Check } from "lucide-react";
import Link from "next/link";
import type { ComponentType } from "react";

// クエストの種類ごとのアイコン（Todayの導線・Re:Gardenと同じ意味で使う）
const QUEST_ICONS: Record<DailyQuestKind, ComponentType<{ size?: number; className?: string }>> = {
  register: DoodleHangerPlus,
  review: DoodleTag,
  wear: DoodleShirt,
};

// Todayの「今日のRe:Quest」。今日、何か1つ行動できたかを3つのアイコンタイルで見せる
// （今週の行動日は「今週のRe:Closet」＝WeeklyProgressCardにまとめて表示する）。
// 達成はふだんの記録から自動で判定する。できていないクエストは中立の表示にして、責めない。
// すぐ下にRe:Gardenを並べ、ここでの行動が庭を育てることを配置で伝える
export function ReQuestCard({ progress }: { progress: ReQuestProgress }) {
  return (
    <section aria-labelledby="re-quest-title">
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <h2 id="re-quest-title" className="text-lg font-semibold">
            {RE_QUEST_CARD_TITLE}
          </h2>
          {/* 今日の達成状況をひと目で（達成していない日も責めない言葉にする） */}
          {progress.achievedToday ? (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-blush/20 px-2.5 py-1 text-xs font-medium text-blush-foreground">
              <Check className="h-3.5 w-3.5" aria-hidden="true" />
              今日は達成
            </span>
          ) : (
            <span className="shrink-0 rounded-full bg-secondary px-2.5 py-1 text-xs text-muted-foreground">
              1つでOK
            </span>
          )}
        </div>
        {/* 達成した日に一度だけ、お祝いの言葉を出す（ふだんは言葉を置かない） */}
        <ReQuestCelebration
          achievedToday={progress.achievedToday}
          todayDateKey={progress.todayDateKey}
        >
          {null}
        </ReQuestCelebration>

        <ul className="grid grid-cols-3 gap-2">
          {progress.quests.map((quest) => {
            const copy = DAILY_QUEST_COPY[quest.kind];
            const Icon = QUEST_ICONS[quest.kind];
            return (
              <li key={quest.kind}>
                <Link
                  href={copy.href}
                  className={cn(
                    "flex h-full min-h-[6.25rem] flex-col items-center justify-center gap-2 rounded-2xl px-1.5 py-3 text-center outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                    quest.done
                      ? "bg-primary/10 hover:bg-primary/15"
                      : "bg-secondary/70 hover:bg-accent active:bg-accent",
                  )}
                >
                  <span
                    className="relative flex h-12 w-12 items-center justify-center rounded-full bg-card text-primary"
                    aria-hidden="true"
                  >
                    <Icon size={28} />
                    {/* できたクエストはセージの丸にチェック（まだのものに否定の印は付けない） */}
                    {quest.done && (
                      <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground ring-2 ring-background">
                        <Check className="h-3 w-3" strokeWidth={3} />
                      </span>
                    )}
                  </span>
                  <span className="text-xs font-medium leading-tight" aria-hidden="true">
                    {copy.shortLabel}
                  </span>
                  <span className="sr-only">
                    {copy.label}
                    {quest.done ? `（達成：${copy.doneLabel(quest.count)}）` : ""}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

// 取得に失敗したとき（未達成と誤表示しない）
export function ReQuestError() {
  return (
    <section aria-labelledby="re-quest-title">
      <div className="flex flex-col gap-3">
        <h2 id="re-quest-title" className="text-lg font-semibold">
          {RE_QUEST_CARD_TITLE}
        </h2>
        <p className="rounded-xl bg-secondary/60 px-4 py-3 text-sm text-muted-foreground">
          {RE_QUEST_LOAD_ERROR_MESSAGE}
        </p>
      </div>
    </section>
  );
}
