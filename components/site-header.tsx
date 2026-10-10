import { BrandMark } from "@/components/brand-mark";
import { EnvVarWarning } from "@/components/env-var-warning";
import { HeaderMainNav } from "@/components/main-nav";
import { Button } from "@/components/ui/button";
import { getCurrentClaims } from "@/lib/supabase/current-user";
import { hasEnvVars } from "@/lib/utils";
import Link from "next/link";
import { Suspense } from "react";

export function HeaderLogo({ href }: { href: string }) {
  return (
    <Link href={href} className="flex items-center gap-1.5 font-semibold text-base">
      <BrandMark size={20} />
      Re:Closet
    </Link>
  );
}

// ロゴのリンク先とメニューはログイン状態で切り替える。
// スマホはロゴ中心のシンプルな表示にし、ログイン中のメニューはBottomNavに任せる。
async function SiteHeaderContent() {
  const user = await getCurrentClaims();

  if (!user) {
    return (
      // 常設の認証導線（新規登録・ログイン）。ボタン2つが320px幅でもロゴと
      // 重ならないよう、未ログイン時はスマホでもロゴを左・ボタンを右に置く。
      // Loopトップへはロゴで戻れるため、Loopへのリンクは置かない。
      <div className="flex w-full items-center justify-between gap-2">
        <HeaderLogo href="/" />
        <div className="flex shrink-0 items-center gap-2">
          <Button asChild size="sm">
            <Link href="/auth/sign-up">新規登録</Link>
          </Button>
          <Button asChild size="sm" variant="outline">
            <Link href="/auth/login">ログイン</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <>
      <HeaderLogo href="/today" />
      <div className="hidden md:block">
        <HeaderMainNav />
      </div>
    </>
  );
}

export function SiteHeader() {
  return (
    <header className="w-full flex justify-center border-b border-b-foreground/10">
      <div className="relative w-full max-w-5xl flex h-14 items-center justify-center gap-3 px-5 text-sm md:justify-between">
        {!hasEnvVars ? (
          <>
            <HeaderLogo href="/" />
            <EnvVarWarning />
          </>
        ) : (
          <Suspense fallback={<HeaderLogo href="/" />}>
            <SiteHeaderContent />
          </Suspense>
        )}
      </div>
    </header>
  );
}
