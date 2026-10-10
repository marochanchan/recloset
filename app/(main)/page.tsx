import { ItemGridSkeleton } from "@/components/loading-skeletons";
import { LoopFeed } from "@/components/loop-feed";
import { LoopIntro } from "@/components/loop-intro";
import { WelcomeDialog } from "@/components/welcome-dialog";
import { getCurrentClaims } from "@/lib/supabase/current-user";
import { Suspense } from "react";

// 初回案内は未ログインのときだけ（ログイン中はproxyで/todayへ移るが念のため判定する）
async function GuestWelcomeDialog() {
  const user = await getCurrentClaims();
  return user ? null : <WelcomeDialog />;
}

// 未ログインのトップ = Re:Closet Loop（/discover と同じ見出し・一覧）。
// 説明よりも、公開服を眺める体験を優先し、Re:Closetの案内は初回のダイアログで出す。
// ログイン中は proxy（lib/supabase/proxy.ts）で /today へリダイレクトされる。
export default function Home() {
  return (
    <div className="flex-1 w-full flex flex-col gap-5 max-w-5xl p-5">
      <LoopIntro />

      <Suspense fallback={<ItemGridSkeleton variant="discover" />}>
        <LoopFeed />
      </Suspense>

      <Suspense fallback={null}>
        <GuestWelcomeDialog />
      </Suspense>
    </div>
  );
}
