import { ItemGridSkeleton } from "@/components/loading-skeletons";
import { LoopFeed } from "@/components/loop-feed";
import { LoopIntro } from "@/components/loop-intro";
import type { Metadata } from "next";
import { Suspense } from "react";

export const metadata: Metadata = {
  title: "Re:Closet Loop",
  description:
    "服を手放すことは、捨てることじゃない。Re:Closetのユーザーが手放そうとしている服を、次の人へつなぐ場所です。",
};

export default function DiscoverPage() {
  return (
    <div className="w-full flex flex-col gap-5">
      <LoopIntro />

      <Suspense fallback={<ItemGridSkeleton variant="discover" />}>
        <LoopFeed />
      </Suspense>
    </div>
  );
}
