import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getCurrentClaims } from "@/lib/supabase/current-user";
import { ArrowRight } from "lucide-react";
import Link from "next/link";

// Re:Closet Loop（/discover, /discover/[id]）からRe:Closet自体へつなぐ導線。
// ログイン状態はヘッダーと同じgetCurrentClaims（リクエスト内でキャッシュ）で判定する。

/** /discover のHero内に置くボタン群 */
export async function DiscoverHeroActions() {
  const user = await getCurrentClaims();

  return (
    <div className="flex flex-wrap justify-center gap-3">
      {user ? (
        <>
          <Button asChild>
            <Link href="/protected/items">自分のクローゼットを見る</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/protected/items/new">服を登録する</Link>
          </Button>
        </>
      ) : (
        <>
          <Button asChild>
            <Link href="/auth/sign-up">自分のクローゼットをつくる</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/auth/login">ログイン</Link>
          </Button>
        </>
      )}
    </div>
  );
}

/** /discover/[id] の服の下に置く案内カード */
export async function DiscoverCta() {
  const user = await getCurrentClaims();

  if (!user) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            あなたのクローゼットも整理してみませんか？
          </CardTitle>
          <CardDescription>
            服を記録して、着用履歴やAIのアドバイスをもとに、これからも着る服・手放す服を整理できます。
            手放す服は、Re:Closet Loopで次の人へつなげます。
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button asChild>
            <Link href="/auth/sign-up">自分のクローゼットをつくる</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/auth/login">ログイン</Link>
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          あなたの服も、次の誰かへつなぎませんか？
        </CardTitle>
        <CardDescription>
          クローゼットから服を選び、詳細ページの「公開する」から
          Re:Closet Loopに公開できます。
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        <Button asChild>
          <Link href="/protected/items">自分のクローゼットを見る</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/protected/items/new">服を登録する</Link>
        </Button>
      </CardContent>
    </Card>
  );
}

/**
 * 未ログイン時だけ、一覧をスクロールしても登録導線を見失わないための小さな案内。
 * fixedではなくstickyにしているため、ページ末尾では通常の位置に戻り、
 * フッターに重ならない。
 */
export async function DiscoverStickyCta() {
  const user = await getCurrentClaims();

  if (user) {
    return null;
  }

  return (
    <div className="sticky bottom-4 z-10 self-center">
      <Link
        href="/auth/sign-up"
        className="flex items-center gap-3 rounded-full border bg-background/95 py-2 pl-4 pr-3 text-sm shadow-md backdrop-blur transition-colors hover:bg-accent"
      >
        <span className="text-muted-foreground">あなたの服もRe:Closetへ</span>
        <span className="flex items-center gap-1 font-medium">
          はじめる
          <ArrowRight className="h-4 w-4" />
        </span>
      </Link>
    </div>
  );
}
