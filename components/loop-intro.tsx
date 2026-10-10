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
      className="inline-flex h-8 w-fit items-center gap-1.5 rounded-full border px-3 text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
    >
      <Heart className="h-3.5 w-3.5" aria-hidden="true" />
      気になる服
    </Link>
  );
}

/**
 * Re:Closet Loopの見出し（/ と /discover で共通）。
 * スマホで公開服一覧がファーストビューに入るよう、大きなヒーローにはしない。
 */
export function LoopIntro() {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <p className="text-xs font-medium tracking-wide text-muted-foreground">
          Re:Closet Loop
        </p>
        <h1 className="text-xl font-bold tracking-tight sm:text-2xl">
          誰かのクローゼットをのぞいてみる
        </h1>
        <p className="text-sm text-muted-foreground">
          手放そうとしている服を、次の人へつなぐ場所です。
        </p>
      </div>
      <Suspense fallback={null}>
        <LoopLikesLink />
      </Suspense>
    </section>
  );
}
