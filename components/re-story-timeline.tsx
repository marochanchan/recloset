import type { StoryKind, StoryTimelineDay } from "@/lib/re-story";
import {
  formatStoryDate,
  getStoryActionSentence,
  getStoryItemsDescription,
  STORY_KIND_LABELS,
} from "@/lib/re-story-copy";
import { cn } from "@/lib/utils";

// 種類ごとの小さな印（色だけに頼らず、種類名も文字で添える）。
// セージとくすみピンクを交互に使い、少しだけ華やかにする
const KIND_DOT_CLASS: Record<StoryKind, string> = {
  register: "bg-primary",
  wear: "bg-blush-foreground",
  review: "bg-primary/60",
  organize: "bg-blush",
  circulate: "bg-muted-foreground/60",
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
// 左に日にち、右にその日のできごとを、細い線でつないで並べる
export function ReStoryTimeline({
  days,
  photoOnlyTitle,
}: {
  days: StoryTimelineDay[];
  photoOnlyTitle: string;
}) {
  return (
    <section aria-labelledby="re-story-timeline-title" className="flex flex-col gap-4">
      <h3 id="re-story-timeline-title" className="text-base font-bold">
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
                <span aria-hidden="true" className="text-2xl font-bold leading-none tabular-nums">
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
                  return (
                    <li
                      key={group.action}
                      className="relative flex flex-col gap-1 rounded-xl border border-border/60 bg-card px-3.5 py-2.5"
                    >
                      <span
                        className={cn(
                          "absolute -left-[1.3rem] top-4 h-2.5 w-2.5 rounded-full ring-4 ring-background",
                          KIND_DOT_CLASS[group.kind],
                        )}
                        aria-hidden="true"
                      />
                      <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                        <span
                          className={cn("h-1.5 w-1.5 rounded-full", KIND_DOT_CLASS[group.kind])}
                          aria-hidden="true"
                        />
                        {STORY_KIND_LABELS[group.kind]}
                      </span>
                      <p className="break-words text-sm leading-relaxed">
                        {getStoryActionSentence(group)}
                      </p>
                      {items && (
                        <p className="break-words text-xs text-muted-foreground">{items}</p>
                      )}
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
