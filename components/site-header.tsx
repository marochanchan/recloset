import { AuthButton } from "@/components/auth-button";
import { BrandMark } from "@/components/brand-mark";
import { EnvVarWarning } from "@/components/env-var-warning";
import { Button } from "@/components/ui/button";
import { getCurrentClaims } from "@/lib/supabase/current-user";
import { hasEnvVars } from "@/lib/utils";
import Link from "next/link";
import { Suspense } from "react";

async function SiteHeaderNav() {
  const user = await getCurrentClaims();

  if (!user) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Link
          href="/discover"
          className="mr-2 text-muted-foreground hover:text-foreground"
        >
          Re:Closet Loop
        </Link>
        <Button asChild size="sm" variant="outline">
          <Link href="/auth/login">ログイン</Link>
        </Button>
        <Button asChild size="sm">
          <Link href="/auth/sign-up">新規登録</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-4">
      <Link href="/" className="text-muted-foreground hover:text-foreground">
        ホーム
      </Link>
      <Link
        href="/protected/items"
        className="text-muted-foreground hover:text-foreground"
      >
        クローゼット
      </Link>
      <Link
        href="/protected/items/new"
        className="text-muted-foreground hover:text-foreground"
      >
        服を登録
      </Link>
      <Link
        href="/discover"
        className="text-muted-foreground hover:text-foreground"
      >
        Re:Closet Loop
      </Link>
      <AuthButton />
    </div>
  );
}

export function SiteHeader() {
  return (
    <nav className="w-full flex justify-center border-b border-b-foreground/10">
      <div className="w-full max-w-5xl flex flex-wrap justify-between items-center gap-3 p-3 px-5 text-sm">
        <Link
          href="/"
          className="flex items-center gap-1.5 font-semibold text-base"
        >
          <BrandMark size={20} />
          Re:Closet
        </Link>
        {!hasEnvVars ? (
          <EnvVarWarning />
        ) : (
          <Suspense fallback={null}>
            <SiteHeaderNav />
          </Suspense>
        )}
      </div>
    </nav>
  );
}
