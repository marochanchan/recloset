import { getCurrentClaims } from "@/lib/supabase/current-user";
import { Heart } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";

// ログイン中だけ「気になる服」への小さなサブ導線を出す。
// 未ログインの登録・ログイン導線はヘッダー・初回案内に任せ、
// 見出しのすぐ下から公開服一覧が始まるようにする。
async function LoopLikesLink() {
  const user = await getCurrentClaims();
  if (!user) return null;

  return (
    <Link
      href="/protected/likes"
      className="inline-flex h-9 w-fit items-center gap-1.5 rounded-full border border-border bg-card px-3.5 text-sm text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Heart className="h-3.5 w-3.5 text-blush-foreground" aria-hidden="true" />
      気になる服
    </Link>
  );
}

/**
 * Re:Closet Loopの見出し（/ と /discover で共通）。
 * スマホで公開服一覧がファーストビューに入るよう、大きなヒーローにはしない。
 * トップ（/）ではサービス紹介がh1のため、headingLevel="h2" で見出しを1段下げる
 * （見た目は変えない）。
 */
export function LoopIntro({
  headingLevel = "h1",
}: {
  headingLevel?: "h1" | "h2";
}) {
  const Heading = headingLevel;
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <p className="text-xs font-medium tracking-[0.2em] text-primary">
          Re:Closet Loop
        </p>
        <Heading className="text-2xl font-bold sm:text-3xl">
          誰かのクローゼットをのぞいてみる
        </Heading>
        <p className="text-sm text-muted-foreground">
          Re:Closetで服を見直した持ち主が、「次の誰かへつなぎたい」と公開した服です。
        </p>
      </div>
      <Suspense fallback={null}>
        <LoopLikesLink />
      </Suspense>
    </section>
  );
}
