import type { StoryMonthNav } from "@/lib/re-story";
import { formatStoryMonth } from "@/lib/re-story-copy";
import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";

const storyMonthHref = (monthKey: string) => `/protected/story?month=${monthKey}`;

// 前の月・次の月の丸いボタン（文字は読み上げ用に残す）
const MONTH_LINK_CLASS =
  "flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-border bg-card text-foreground outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring active:bg-accent";

// 月の切り替え。最初の行動の月より前・今月より先には移動できない。
// 誌面の扉のように、年を小さく・月を大きく見せる
export function ReStoryMonthNav({ nav }: { nav: StoryMonthNav }) {
  const [year, month] = nav.monthKey.split("-").map(Number);

  return (
    <nav aria-label="表示する月" className="flex items-center justify-between gap-2">
      {nav.prevMonthKey ? (
        <Link
          href={storyMonthHref(nav.prevMonthKey)}
          aria-label={`前の月（${formatStoryMonth(nav.prevMonthKey)}）へ`}
          className={MONTH_LINK_CLASS}
        >
          <ChevronLeft className="h-5 w-5" aria-hidden="true" />
        </Link>
      ) : (
        <span className="w-11" aria-hidden="true" />
      )}
      <h2 className="flex flex-col items-center tabular-nums" aria-live="polite">
        <span className="sr-only">{formatStoryMonth(nav.monthKey)}</span>
        <span aria-hidden="true" className="text-xs tracking-[0.2em] text-muted-foreground">
          {year}
        </span>
        <span aria-hidden="true" className="text-3xl font-semibold leading-tight">
          {month}
          <span className="ml-0.5 text-lg">月</span>
        </span>
      </h2>
      {nav.nextMonthKey ? (
        <Link
          href={storyMonthHref(nav.nextMonthKey)}
          aria-label={`次の月（${formatStoryMonth(nav.nextMonthKey)}）へ`}
          className={MONTH_LINK_CLASS}
        >
          <ChevronRight className="h-5 w-5" aria-hidden="true" />
        </Link>
      ) : (
        <span className="w-11" aria-hidden="true" />
      )}
    </nav>
  );
}
