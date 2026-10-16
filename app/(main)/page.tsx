import { ItemGridSkeleton } from "@/components/loading-skeletons";
import { LoopFeed } from "@/components/loop-feed";
import { LoopIntro } from "@/components/loop-intro";
import { Button } from "@/components/ui/button";
import {
  WelcomeDialog,
  WelcomeDialogTrigger,
} from "@/components/welcome-dialog";
import { getCurrentClaims } from "@/lib/supabase/current-user";
import Link from "next/link";
import { Suspense } from "react";

// 初回案内は未ログインのときだけ（ログイン中はproxyで/todayへ移るが念のため判定する）
async function GuestWelcomeDialog() {
  const user = await getCurrentClaims();
  return user ? null : <WelcomeDialog />;
}

// トップだけに常に出す、Re:Closetの短い紹介（初回ダイアログを閉じた後も価値が伝わるように）。
// スマホで公開服一覧が遠くならないよう、文章は2文・ボタンは2つに抑える
function HomeIntro() {
  return (
    <section
      aria-labelledby="home-intro-title"
      className="flex flex-col gap-3 rounded-3xl bg-gradient-to-br from-primary/10 via-secondary/50 to-blush/20 px-5 py-6 sm:p-8"
    >
      <h1
        id="home-intro-title"
        className="text-2xl font-bold leading-snug sm:text-3xl"
      >
        <span className="inline-block">着る、残す、手放す。</span>
        <span className="inline-block">服とのこれからを考える。</span>
      </h1>
      <p className="text-sm leading-relaxed text-muted-foreground">
        写真1枚から、クローゼットを記録。着用履歴やAIの提案をヒントに、あなた自身が服のこれからを選べます。
      </p>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Button asChild className="min-h-11 w-full sm:w-auto">
          <Link href="/auth/sign-up">新規登録してはじめる</Link>
        </Button>
        <WelcomeDialogTrigger className="min-h-11 w-full sm:w-auto" />
      </div>
    </section>
  );
}

// 未ログインのトップ = Re:Closetの短い紹介 + Re:Closet Loop（/discover と同じ一覧）。
// 詳しい流れは初回のダイアログ（「使い方を見る」から再表示できる）で案内する。
// ログイン中は proxy（lib/supabase/proxy.ts）で /today へリダイレクトされる。
export default function Home() {
  return (
    <div className="flex-1 w-full flex flex-col gap-8 max-w-5xl p-5">
      <HomeIntro />

      <LoopIntro headingLevel="h2" />

      <Suspense fallback={<ItemGridSkeleton variant="discover" />}>
        <LoopFeed />
      </Suspense>

      <Suspense fallback={null}>
        <GuestWelcomeDialog />
      </Suspense>
    </div>
  );
}
