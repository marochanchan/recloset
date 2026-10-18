import { DoodleHanger, DoodleTag } from "@/components/doodle-icons";
import { StartClosetReviewButton } from "@/components/start-closet-review-button";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  MAX_REVIEW_SESSION_ITEMS,
  REVIEW_SESSION_STATUSES,
} from "@/lib/closet-review";
import { createClient } from "@/lib/supabase/server";
import type { Metadata } from "next";
import { ArrowLeft, ArrowRight, ChevronLeft } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";

export const metadata: Metadata = {
  title: "まとめて見直す | Re:Closet",
};

// 見直しの開始・再開。未完了のセッション（1人1つまで）があれば続きから再開する。
// ページを開いただけではセッションを作らない（開始はボタンから）
async function ReviewHome() {
  const supabase = await createClient();
  const [openResult, lastCompletedResult, reviewableResult] = await Promise.all([
    supabase
      .from("closet_review_sessions")
      .select("id, item_ids, closet_review_decisions(count)")
      .is("completed_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("closet_review_sessions")
      .select("id")
      .not("completed_at", "is", null)
      .order("completed_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("clothing_items")
      .select("*", { count: "exact", head: true })
      .in("status", [...REVIEW_SESSION_STATUSES]),
  ]);

  if (openResult.error || lastCompletedResult.error || reviewableResult.error) {
    console.error(
      "review home fetch error:",
      openResult.error ?? lastCompletedResult.error ?? reviewableResult.error,
    );
    return (
      <p className="text-sm text-muted-foreground">
        読み込めませんでした。時間をおいてお試しください。
      </p>
    );
  }

  const openSession = openResult.data;
  const lastCompleted = lastCompletedResult.data;
  const reviewableCount = reviewableResult.count ?? 0;

  let main: React.ReactNode;
  if (openSession) {
    const total = Array.isArray(openSession.item_ids)
      ? openSession.item_ids.length
      : 0;
    const decidedCount =
      (openSession.closet_review_decisions as { count: number }[] | null)?.[0]
        ?.count ?? 0;
    main = (
      <Card className="flex flex-col gap-3 p-4">
        <p className="font-medium">途中の見直しがあります</p>
        <p className="text-sm text-muted-foreground">
          {total}着のうち{Math.min(decidedCount, total)}着まで進んでいます。続きから再開できます。
        </p>
        <Button asChild size="lg" className="w-full">
          <Link href={`/protected/review/${openSession.id}`}>続きから見直す</Link>
        </Button>
      </Card>
    );
  } else if (reviewableCount === 0) {
    main = (
      <div className="flex flex-col items-center gap-3 rounded-2xl bg-secondary/60 px-6 py-12 text-center">
        <DoodleHanger size={40} className="text-primary/60" />
        <p className="font-medium">見直せる服がありません</p>
        <p className="text-sm text-muted-foreground">
          まずはクローゼットに服を登録してみましょう。写真だけで、1着でもまとめてでも登録できます。
        </p>
        <Button asChild size="sm">
          <Link href="/protected/items/new?mode=photo">写真だけで登録</Link>
        </Button>
      </div>
    );
  } else {
    main = (
      <Card className="flex flex-col gap-3 p-4">
        <p className="text-sm text-muted-foreground">
          最近見直していない服から、最大{MAX_REVIEW_SESSION_ITEMS}着を1着ずつ見ていきます。
        </p>
        {/* スワイプの向きと判断を、絵で先に伝える */}
        <div role="img" className="flex items-center justify-center gap-3 rounded-2xl bg-secondary/60 px-3 py-3 text-xs" aria-label="左にスワイプで迷う、右にスワイプで残す">
          <span className="flex items-center gap-1 text-muted-foreground" aria-hidden="true">
            <ArrowLeft className="h-4 w-4" />
            迷う
          </span>
          <span className="flex h-12 w-9 items-center justify-center rounded-lg bg-card text-primary shadow-sm" aria-hidden="true">
            <DoodleHanger size={22} />
          </span>
          <span className="flex items-center gap-1 font-medium text-primary" aria-hidden="true">
            残す
            <ArrowRight className="h-4 w-4" />
          </span>
        </div>
        <StartClosetReviewButton label="見直しを始める" />
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {main}
      {lastCompleted && (
        <Link
          href={`/protected/review/${lastCompleted.id}`}
          className="w-fit text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
        >
          前回の見直しの結果を見る
        </Link>
      )}
    </div>
  );
}

export default function ClosetReviewPage() {
  return (
    <div className="w-full max-w-md mx-auto flex flex-col gap-6">
      <Link href="/protected/items" className="-ml-1 flex min-h-10 w-fit items-center gap-1 rounded-lg pr-2 text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        クローゼット
      </Link>
      <div className="flex flex-col gap-1">
        <h1 className="flex items-center gap-2 text-2xl font-semibold">
          <DoodleTag size={28} className="text-primary" />
          まとめて見直す
        </h1>
        <p className="text-sm text-muted-foreground">
          残す・迷う・手放し候補を、テンポよく選んでいきます。服の状態は変わりません。
        </p>
      </div>
      <Suspense fallback={<Skeleton className="h-36 w-full" />}>
        <ReviewHome />
      </Suspense>
    </div>
  );
}
