import type { StoryKind, StoryTimelineDay } from "@/lib/re-story";
import {
  formatStoryDate,
  getStoryActionSentence,
  getStoryItemsDescription,
  STORY_KIND_LABELS,
} from "@/lib/re-story-copy";
import { cn } from "@/lib/utils";

// 種類ごとの小さな印（色だけに頼らず、種類名も文字で添える）
const KIND_DOT_CLASS: Record<StoryKind, string> = {
  register: "bg-primary",
  wear: "bg-primary/70",
  review: "bg-primary/50",
  organize: "bg-muted-foreground/60",
  circulate: "bg-muted-foreground/40",
};

// 日付ごとのタイムライン。「日付 × 具体的な行動」でまとめ、
// 一括登録なども件数と代表的な服の名前（最大2着）で1行にする
export function ReStoryTimeline({
  days,
  photoOnlyTitle,
}: {
  days: StoryTimelineDay[];
  photoOnlyTitle: string;
}) {
  return (
    <section aria-labelledby="re-story-timeline-title" className="flex flex-col gap-3">
      <h3 id="re-story-timeline-title" className="text-base font-semibold">
        この月のできごと
      </h3>
      <ol className="flex flex-col gap-4">
        {days.map((day) => (
          <li key={day.dateKey} className="flex flex-col gap-2">
            <h4 className="text-sm font-medium text-muted-foreground">
              <time dateTime={day.dateKey}>{formatStoryDate(day.dateKey)}</time>
            </h4>
            <ul className="flex flex-col gap-2 border-l pl-4">
              {day.groups.map((group) => {
                const items = getStoryItemsDescription(group, photoOnlyTitle);
                return (
                  <li key={group.action} className="relative flex flex-col gap-0.5">
                    <span
                      className={cn(
                        "absolute -left-[1.3rem] top-1.5 h-2.5 w-2.5 rounded-full ring-2 ring-background",
                        KIND_DOT_CLASS[group.kind],
                      )}
                      aria-hidden="true"
                    />
                    <p className="break-words text-sm">
                      <span className="mr-1.5 text-xs text-muted-foreground">
                        {STORY_KIND_LABELS[group.kind]}
                      </span>
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
        ))}
      </ol>
    </section>
  );
}
