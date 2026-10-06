import { ClosetSummary } from "@/components/closet-summary";
import { OnboardingSteps } from "@/components/onboarding-steps";
import { SiteHeader } from "@/components/site-header";
import { TodayReTryCard } from "@/components/today-re-try-card";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";
import { getWearRecencyLabel } from "@/lib/wear-logs";
import Link from "next/link";
import { Suspense } from "react";

const SIGNED_URL_EXPIRES_IN = 600; // 10分

async function HomeContent() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const user = data?.claims;

  if (!user) {
    return (
      <div className="flex w-full flex-col items-center gap-6 text-center">
        <p className="max-w-md text-muted-foreground">
          着ていない服に気づき、
          もう一度着る・残す・手放すを考える
          クローゼットアシスタント。
        </p>
        <div className="flex gap-3">
          <Button asChild>
            <Link href="/auth/login">ログイン</Link>
          </Button>
          <Button asChild variant="outline">
            <Link href="/auth/sign-up">新規登録</Link>
          </Button>
        </div>
        <Link
          href="/discover"
          className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
        >
          Re:Closet Loopを見る
        </Link>
        <OnboardingSteps className="mt-4 max-w-2xl" />
      </div>
    );
  }

  const [reTryResult, totalResult, favoriteResult, candidateResult] =
    await Promise.all([
      supabase
        .from("clothing_items")
        .select(
          "id, title, brand, last_worn_at, clothing_images(image_path, sort_order)",
        )
        .not("last_worn_at", "is", null)
        .order("last_worn_at", { ascending: true })
        .order("sort_order", { referencedTable: "clothing_images" })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("clothing_items")
        .select("*", { count: "exact", head: true }),
      supabase
        .from("clothing_items")
        .select("*", { count: "exact", head: true })
        .eq("favorite", true),
      supabase
        .from("clothing_items")
        .select("*", { count: "exact", head: true })
        .eq("status", "candidate"),
    ]);

  const reTryItem = reTryResult.data;
  let reTryImageUrl: string | null = null;

  if (reTryItem) {
    const path = reTryItem.clothing_images[0]?.image_path;
    if (path) {
      const { data: signedUrlData, error: signError } = await supabase.storage
        .from("clothing-images")
        .createSignedUrl(path, SIGNED_URL_EXPIRES_IN);

      if (signError) {
        console.error("home re-try signed url error:", signError);
      } else {
        reTryImageUrl = signedUrlData?.signedUrl ?? null;
      }
    }
  }

  // 件数の取得に成功し、かつ0件のときだけ初回向けの案内を出す
  // （取得失敗を0件扱いして既存ユーザーに表示しないため）
  const isClosetEmpty = !totalResult.error && totalResult.count === 0;

  return (
    <div className="flex w-full max-w-3xl flex-col gap-10">
      {isClosetEmpty ? (
        <OnboardingSteps showRegisterCta />
      ) : (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">今日のRe:try</h2>
          {reTryItem ? (
            <TodayReTryCard
              itemId={reTryItem.id}
              title={reTryItem.title}
              brand={reTryItem.brand}
              wearRecencyLabel={getWearRecencyLabel(reTryItem.last_worn_at)}
              imageUrl={reTryImageUrl}
            />
          ) : (
            <Card>
              <CardContent className="flex flex-col gap-1 pt-6 text-sm text-muted-foreground">
                <p>まだRe:tryできる服がありません</p>
                <p>
                  着用記録をつけると、しばらく着ていない服をここでお知らせします
                </p>
              </CardContent>
            </Card>
          )}
        </section>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">クローゼットサマリー</h2>
        <ClosetSummary
          totalCount={totalResult.count ?? 0}
          favoriteCount={favoriteResult.count ?? 0}
          candidateCount={candidateResult.count ?? 0}
        />
      </section>

      <div className="flex flex-wrap gap-3">
        <Button asChild>
          <Link href="/protected/items">クローゼットを見る</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/protected/items/new">服を登録する</Link>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">AI診断</CardTitle>
          <CardDescription>
            着用履歴をもとに、「残す・もう一度着る・手放す」を一緒に考えます。
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            クローゼットから服を選び、詳細ページの「AI診断」から診断できます。
          </p>
          <Button asChild variant="outline" className="w-fit">
            <Link href="/protected/items">診断する服を選ぶ</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

export default function Home() {
  return (
    <main className="min-h-screen flex flex-col items-center">
      <SiteHeader />
      <div className="flex flex-1 w-full flex-col items-center gap-10 px-4 py-12">
        <div className="flex flex-col items-center gap-2 text-center">
          <h1 className="text-3xl font-bold">Re:Closet</h1>
          <p className="text-lg text-muted-foreground">
            クローゼットの服を、もう一度。
          </p>
        </div>

        <Suspense
          fallback={
            <p className="text-sm text-muted-foreground">読み込み中...</p>
          }
        >
          <HomeContent />
        </Suspense>
      </div>
    </main>
  );
}
