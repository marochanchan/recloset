import { DoodleBook } from "@/components/doodle-icons";
import { ReStorySkeleton } from "@/components/loading-skeletons";
import { ReStoryMonthNav } from "@/components/re-story-month-nav";
import { ReStoryMonthSummary } from "@/components/re-story-month-summary";
import { ReStoryTimeline } from "@/components/re-story-timeline";
import { Button } from "@/components/ui/button";
import { PHOTO_ONLY_TITLE } from "@/lib/clothing-options";
import {
  RE_STORY_EMPTY_MONTH_MESSAGE,
  RE_STORY_LEAD,
  RE_STORY_LOAD_ERROR_MESSAGE,
  RE_STORY_NO_EVENTS_MESSAGE,
  RE_STORY_OVER_LIMIT_MESSAGE,
  RE_STORY_TITLE,
} from "@/lib/re-story-copy";
import { fetchStoryPage } from "@/lib/re-story-query";
import { getCurrentClaims } from "@/lib/supabase/current-user";
import { createClient } from "@/lib/supabase/server";
import type { Metadata } from "next";
import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";

export const metadata: Metadata = {
  title: "Re:Story | Re:Closet",
};

type SearchParams = Promise<{ month?: string | string[] }>;

const firstParam = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

async function ReStoryContent({ requestedMonth }: { requestedMonth: string | undefined }) {
  const claims = await getCurrentClaims();
  if (!claims?.sub) {
    return <p className="text-sm text-muted-foreground">{RE_STORY_LOAD_ERROR_MESSAGE}</p>;
  }
  const supabase = await createClient();
  const result = await fetchStoryPage(supabase, {
    userId: claims.sub,
    requestedMonth,
    photoOnlyTitle: PHOTO_ONLY_TITLE,
  });

  // 取得エラー・上限超過は、記録0件として表示しない
  if (!result.ok) {
    return (
      <div className="flex flex-col gap-4">
        {result.nav && <ReStoryMonthNav nav={result.nav} />}
        <p
          className="rounded-2xl bg-secondary/60 px-4 py-3 text-sm text-muted-foreground"
          role="alert"
        >
          {result.reason === "over_limit"
            ? RE_STORY_OVER_LIMIT_MESSAGE
            : RE_STORY_LOAD_ERROR_MESSAGE}
        </p>
      </div>
    );
  }

  const { nav, hasAnyEvents, summary, timeline, showTrackingNote } = result.data;

  // まだ行動が1件もない人には、始め方を案内する
  if (!hasAnyEvents) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-3xl bg-gradient-to-b from-blush/20 to-secondary/40 px-6 py-12 text-center">
        <DoodleBook size={44} className="text-primary/60" />
        <p className="text-sm text-muted-foreground">{RE_STORY_NO_EVENTS_MESSAGE}</p>
        <Button asChild variant="outline">
          <Link href="/protected/items">クローゼットを見る</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <ReStoryMonthNav nav={nav} />
      <ReStoryMonthSummary summary={summary} showTrackingNote={showTrackingNote} />
      {timeline.length > 0 ? (
        <ReStoryTimeline days={timeline} photoOnlyTitle={PHOTO_ONLY_TITLE} />
      ) : (
        <p className="rounded-2xl bg-secondary/60 px-4 py-8 text-center text-sm text-muted-foreground">
          {RE_STORY_EMPTY_MONTH_MESSAGE}
        </p>
      )}
    </div>
  );
}

async function ReStoryPageContent({ searchParams }: { searchParams: SearchParams }) {
  const requestedMonth = firstParam((await searchParams).month);
  return (
    <Suspense key={requestedMonth ?? "current"} fallback={<ReStorySkeleton />}>
      <ReStoryContent requestedMonth={requestedMonth} />
    </Suspense>
  );
}

export default function ReStoryPage({ searchParams }: { searchParams: SearchParams }) {
  return (
    <div className="w-full max-w-md mx-auto flex flex-col gap-4">
      <Link href="/me" className="-ml-1 flex min-h-10 w-fit items-center gap-1 rounded-lg pr-2 text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        My Page
      </Link>
      <div className="flex flex-col gap-1">
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <DoodleBook size={28} className="text-primary" />
          {RE_STORY_TITLE}
        </h1>
        <p className="text-sm text-muted-foreground">{RE_STORY_LEAD}</p>
      </div>
      <Suspense fallback={<ReStorySkeleton />}>
        <ReStoryPageContent searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
