import { STORY_KINDS, type StoryMonthSummary } from "@/lib/re-story";
import {
  getStoryMonthMessage,
  RE_STORY_TRACKING_NOTE,
  STORY_KIND_LABELS,
} from "@/lib/re-story-copy";

// 月のまとめ。活動日数（日）と行動の回数・着数を分けて表示する
// （Re:Garden のポイントとは見せ方を分ける）。
// 誌面風に、ひとことと「行動した日」の大きな数字を主役にし、
// 種類ごとの日数は細い棒、行動の記録は記録のあったものだけを短い言葉で添える
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
  const recordedCounts = counts.filter(({ value }) => value > 0);
  // 棒の長さは、その月に行動した日数に対する割合（0日の月は棒を出さない）
  const maxDays = Math.max(summary.activeDays, 1);

  return (
    <section aria-labelledby="re-story-summary-title">
      <div className="flex flex-col gap-5 rounded-3xl bg-gradient-to-b from-blush/20 to-secondary/40 px-5 pb-5 pt-6">
        <h3 id="re-story-summary-title" className="sr-only">
          この月のまとめ
        </h3>

        <div className="flex items-end gap-4">
          <p className="flex shrink-0 flex-col">
            <span className="text-xs text-muted-foreground">行動した日</span>
            <span>
              <span className="text-5xl font-bold leading-none tabular-nums">
                {summary.activeDays}
              </span>
              <span className="ml-1 text-sm">日</span>
            </span>
          </p>
          <p className="min-w-0 break-words border-l border-blush pl-4 text-sm leading-relaxed">
            {getStoryMonthMessage(summary)}
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <p className="text-xs text-muted-foreground">種類ごとの活動日数</p>
          <dl className="flex flex-col gap-1.5">
            {STORY_KINDS.map((kind) => {
              const days = summary.daysByKind[kind];
              return (
                <div key={kind} className="grid grid-cols-[3.5rem_1fr_2.5rem] items-center gap-2">
                  <dt className="text-xs">{STORY_KIND_LABELS[kind]}</dt>
                  <div className="h-1.5 overflow-hidden rounded-full bg-card" aria-hidden="true">
                    <div
                      className="h-full rounded-full bg-primary/70"
                      style={{ width: `${Math.min(days / maxDays, 1) * 100}%` }}
                    />
                  </div>
                  <dd className="text-right text-xs tabular-nums">
                    {days}
                    <span className="text-muted-foreground">日</span>
                  </dd>
                </div>
              );
            })}
          </dl>
        </div>

        {recordedCounts.length > 0 && (
          <div className="flex flex-col gap-2">
            <p className="text-xs text-muted-foreground">行動の記録</p>
            <dl className="flex flex-wrap gap-1.5">
              {recordedCounts.map(({ label, value, unit }) => (
                <div
                  key={label}
                  className="flex items-baseline gap-1 rounded-full bg-card/80 px-3 py-1 text-xs"
                >
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="font-semibold tabular-nums">
                    {value}
                    <span className="font-normal text-muted-foreground">{unit}</span>
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        )}

        {showTrackingNote && (
          <p className="break-words text-xs text-muted-foreground">{RE_STORY_TRACKING_NOTE}</p>
        )}
      </div>
    </section>
  );
}
