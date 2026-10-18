import type { StoryKind, StoryTimelineDay } from "@/lib/re-story";
import {
  formatStoryDate,
  getStoryActionSentence,
  getStoryItemsDescription,
  STORY_KIND_LABELS,
} from "@/lib/re-story-copy";
import {
  DoodleBox,
  DoodleHangerPlus,
  DoodleLoop,
  DoodleShirt,
  DoodleTag,
} from "@/components/doodle-icons";
import { cn } from "@/lib/utils";
import type { ComponentType } from "react";

// 種類ごとの手描きアイコン（Today・Re:Questと同じ意味で使う。種類名も文字で添える）
export const STORY_KIND_ICONS: Record<
  StoryKind,
  ComponentType<{ size?: number; className?: string }>
> = {
  register: DoodleHangerPlus,
  wear: DoodleShirt,
  review: DoodleTag,
  organize: DoodleBox,
  circulate: DoodleLoop,
};

// アイコンの丸の色。セージとくすみピンクを交互に使い、少しだけ華やかにする
const KIND_ICON_CLASS: Record<StoryKind, string> = {
  register: "bg-primary/10 text-primary",
  wear: "bg-blush/25 text-blush-foreground",
  review: "bg-primary/10 text-primary",
  organize: "bg-blush/25 text-blush-foreground",
  circulate: "bg-secondary text-primary",
};

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"] as const;

// 日付の見出しを「日にち（大）＋曜日（小）」に分ける（表示のみ。読み上げは formatStoryDate）
function getDayParts(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const weekday = WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
  return { day, weekday };
}

// 日付ごとのタイムライン。「日付 × 具体的な行動」でまとめ、
// 一括登録なども件数と代表的な服の名前（最大2着）で1行にする。
// 左に日にち、右にその日のできごとを、細い線でつないで並べる。
// できごとは種類のアイコンを先頭に置き、文字を読まなくても流れが見えるようにする
export function ReStoryTimeline({
  days,
  photoOnlyTitle,
}: {
  days: StoryTimelineDay[];
  photoOnlyTitle: string;
}) {
  return (
    <section aria-labelledby="re-story-timeline-title" className="flex flex-col gap-4">
      <h3 id="re-story-timeline-title" className="text-base font-semibold">
        この月のできごと
      </h3>
      <ol className="flex flex-col">
        {days.map((day, dayIndex) => {
          const { day: dayNumber, weekday } = getDayParts(day.dateKey);
          const isLast = dayIndex === days.length - 1;
          return (
            <li key={day.dateKey} className="grid grid-cols-[3rem_1fr] gap-3">
              <h4 className="flex flex-col items-center pt-0.5">
                <time dateTime={day.dateKey} className="sr-only">
                  {formatStoryDate(day.dateKey)}
                </time>
                <span aria-hidden="true" className="text-2xl font-semibold leading-none tabular-nums">
                  {dayNumber}
                </span>
                <span aria-hidden="true" className="mt-1 text-[11px] text-muted-foreground">
                  {weekday}
                </span>
              </h4>
              <ul
                className={cn(
                  "flex flex-col gap-2 border-l border-border pl-4",
                  isLast ? "pb-0" : "pb-6",
                )}
              >
                {day.groups.map((group) => {
                  const items = getStoryItemsDescription(group, photoOnlyTitle);
                  const Icon = STORY_KIND_ICONS[group.kind];
                  return (
                    <li
                      key={group.action}
                      className="relative flex items-start gap-3 rounded-2xl bg-card px-3 py-2.5 shadow-[0_1px_0_hsl(var(--border))]"
                    >
                      <span
                        className="absolute -left-[1.2rem] top-5 h-2 w-2 rounded-full bg-primary/40 ring-4 ring-background"
                        aria-hidden="true"
                      />
                      <span
                        className={cn(
                          "flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
                          KIND_ICON_CLASS[group.kind],
                        )}
                        aria-hidden="true"
                      >
                        <Icon size={20} />
                      </span>
                      <span className="flex min-w-0 flex-col gap-0.5">
                        <span className="text-[11px] text-muted-foreground">
                          {STORY_KIND_LABELS[group.kind]}
                        </span>
                        <span className="break-words text-sm leading-relaxed">
                          {getStoryActionSentence(group)}
                        </span>
                        {items && (
                          <span className="break-words text-xs text-muted-foreground">{items}</span>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
