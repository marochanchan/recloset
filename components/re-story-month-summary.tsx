import { Card } from "@/components/ui/card";
import { STORY_KINDS, type StoryMonthSummary } from "@/lib/re-story";
import {
  getStoryMonthMessage,
  RE_STORY_TRACKING_NOTE,
  STORY_KIND_LABELS,
} from "@/lib/re-story-copy";

// 月のまとめ。活動日数（日）と行動の回数・着数を分けて表示する
// （Re:Garden のポイントとは見せ方を分ける）
export function ReStoryMonthSummary({
  summary,
  showTrackingNote,
}: {
  summary: StoryMonthSummary;
  showTrackingNote: boolean;
}) {
  const counts = [
    { label: "登録", value: summary.registeredItemCount, unit: "着" },
    { label: "着用", value: summary.wearCount, unit: "回" },
    { label: "見直し", value: summary.reviewedItemCount, unit: "着" },
    { label: "整理", value: summary.organizeCount, unit: "回" },
    { label: "循環", value: summary.circulateCount, unit: "回" },
  ];

  return (
    <section aria-labelledby="re-story-summary-title">
      <Card className="flex flex-col gap-3 p-4">
        <h3 id="re-story-summary-title" className="sr-only">
          この月のまとめ
        </h3>
        <p className="break-words text-sm">{getStoryMonthMessage(summary)}</p>

        <div className="flex flex-wrap items-baseline justify-between gap-x-3">
          <p className="text-sm text-muted-foreground">行動した日</p>
          <p className="text-sm">
            <span className="text-2xl font-bold tabular-nums">{summary.activeDays}</span>日
          </p>
        </div>

        <div className="flex flex-col gap-1">
          <p className="text-xs text-muted-foreground">種類ごとの活動日数</p>
          <dl className="grid grid-cols-5 gap-1 text-center">
            {STORY_KINDS.map((kind) => (
              <div key={kind} className="flex flex-col gap-0.5 rounded-md bg-muted/50 px-1 py-2">
                <dt className="text-[11px] text-muted-foreground">{STORY_KIND_LABELS[kind]}</dt>
                <dd className="text-sm font-semibold tabular-nums">
                  {summary.daysByKind[kind]}
                  <span className="text-[10px] font-normal text-muted-foreground">日</span>
                </dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="flex flex-col gap-1 border-t pt-3">
          <p className="text-xs text-muted-foreground">行動の記録</p>
          <dl className="grid grid-cols-5 gap-1 text-center">
            {counts.map(({ label, value, unit }) => (
              <div key={label} className="flex flex-col gap-0.5 px-1 py-1">
                <dt className="text-[11px] text-muted-foreground">{label}</dt>
                <dd className="text-sm font-semibold tabular-nums">
                  {value}
                  <span className="text-[10px] font-normal text-muted-foreground">{unit}</span>
                </dd>
              </div>
            ))}
          </dl>
        </div>

        {showTrackingNote && (
          <p className="break-words text-xs text-muted-foreground">{RE_STORY_TRACKING_NOTE}</p>
        )}
      </Card>
    </section>
  );
}
