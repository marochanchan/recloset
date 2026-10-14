import { Button } from "@/components/ui/button";
import type { StoryMonthNav } from "@/lib/re-story";
import { formatStoryMonth } from "@/lib/re-story-copy";
import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";

const storyMonthHref = (monthKey: string) => `/protected/story?month=${monthKey}`;

// 月の切り替え。最初の行動の月より前・今月より先には移動できない
export function ReStoryMonthNav({ nav }: { nav: StoryMonthNav }) {
  return (
    <nav aria-label="表示する月" className="flex items-center justify-between gap-2">
      {nav.prevMonthKey ? (
        <Button asChild variant="ghost" size="sm" className="min-h-10">
          <Link href={storyMonthHref(nav.prevMonthKey)} aria-label={`${formatStoryMonth(nav.prevMonthKey)}へ`}>
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            前の月
          </Link>
        </Button>
      ) : (
        <span className="w-20" aria-hidden="true" />
      )}
      <h2 className="text-lg font-semibold tabular-nums" aria-live="polite">
        {formatStoryMonth(nav.monthKey)}
      </h2>
      {nav.nextMonthKey ? (
        <Button asChild variant="ghost" size="sm" className="min-h-10">
          <Link href={storyMonthHref(nav.nextMonthKey)} aria-label={`${formatStoryMonth(nav.nextMonthKey)}へ`}>
            次の月
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </Button>
      ) : (
        <span className="w-20" aria-hidden="true" />
      )}
    </nav>
  );
}
