import { BrandMark } from "@/components/brand-mark";
import { ClosetSummary } from "@/components/closet-summary";
import { OnboardingSteps } from "@/components/onboarding-steps";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { TodayOutfitCard } from "@/components/today-outfit-card";
import { Button } from "@/components/ui/button";
import {
  suggestTodayOutfit,
  type OutfitItemInput,
} from "@/lib/outfit-suggestion";
import {
  getCurrentClaims,
  getCurrentDisplayName,
} from "@/lib/supabase/current-user";
import { createClient } from "@/lib/supabase/server";
import { getJstDateKey, getTodayWeather } from "@/lib/weather";
import { getCurrentSeasonJst, getDaysSinceLastWorn } from "@/lib/wear-logs";
import { ArrowRight } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";

const SIGNED_URL_EXPIRES_IN = 600; // 10分

async function HomeContent() {
  const user = await getCurrentClaims();

  if (!user) {
    // 未ログインのファーストビュー。ブランド名はヘッダーに任せ、
    // マークとキャッチコピーを主見出しにする
    return (
      <div className="flex w-full flex-col items-center gap-6 text-center">
        <div className="flex flex-col items-center gap-4">
          <BrandMark size={64} />
          <h1 className="text-3xl font-bold tracking-tight">
            クローゼットの服を、もう一度。
          </h1>
        </div>
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

  const supabase = await createClient();
  const [
    displayName,
    totalResult,
    favoriteResult,
    candidateResult,
    outfitItemsResult,
    weather,
  ] = await Promise.all([
      getCurrentDisplayName(),
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
      // 今日のコーデ候補の対象（手放す予定・売却済みは除外、シューズ等は対象外）
      supabase
        .from("clothing_items")
        .select(
          "id, title, brand, category, season, status, favorite, last_worn_at, clothing_images(image_path, sort_order)",
        )
        .in("status", ["closet", "candidate"])
        .in("category", ["tops", "bottoms", "dress", "outer"])
        .order("sort_order", { referencedTable: "clothing_images" })
        .limit(300),
      // 横浜の今日の天気（30分キャッシュ。失敗時はnull）
      getTodayWeather(),
    ]);

  // 件数の取得に成功し、かつ0件のときだけ初回向けの案内を出す
  // （取得失敗を0件扱いして既存ユーザーに表示しないため）
  const isClosetEmpty = !totalResult.error && totalResult.count === 0;

  // 今日のコーデ候補（服の取得に失敗した場合はカードごと表示しない）
  let outfit: {
    suggestion: ReturnType<typeof suggestTodayOutfit>;
    imageUrls: Map<string, string>;
  } | null = null;

  if (!isClosetEmpty && !outfitItemsResult.error) {
    const now = new Date();
    const outfitItems: OutfitItemInput[] = outfitItemsResult.data.map(
      (item) => ({
        id: item.id,
        title: item.title,
        brand: item.brand,
        category: item.category,
        season: item.season,
        status: item.status,
        favorite: item.favorite,
        daysSinceLastWorn: getDaysSinceLastWorn(item.last_worn_at, now),
        imagePath: item.clothing_images[0]?.image_path ?? null,
      }),
    );
    const suggestion = suggestTodayOutfit({
      items: outfitItems,
      weather,
      currentSeason: getCurrentSeasonJst(now),
      dateKey: getJstDateKey(now),
    });

    const imageUrls = new Map<string, string>();
    const pickPaths = suggestion.picks
      .map((pick) => pick.item.imagePath)
      .filter((path): path is string => Boolean(path));
    if (pickPaths.length > 0) {
      const { data: signedUrls, error: signError } = await supabase.storage
        .from("clothing-images")
        .createSignedUrls(pickPaths, SIGNED_URL_EXPIRES_IN);
      if (signError) {
        console.error("home outfit signed url error:", signError);
      } else {
        const urlByPath = new Map(
          signedUrls
            .filter((entry) => !entry.error && entry.path && entry.signedUrl)
            .map((entry) => [entry.path as string, entry.signedUrl]),
        );
        for (const pick of suggestion.picks) {
          const url = pick.item.imagePath
            ? urlByPath.get(pick.item.imagePath)
            : undefined;
          if (url) imageUrls.set(pick.item.id, url);
        }
      }
    }

    outfit = { suggestion, imageUrls };
  } else if (outfitItemsResult.error) {
    console.error("home outfit items error:", outfitItemsResult.error);
  }

  return (
    <div className="flex w-full max-w-3xl flex-col gap-10">
      <div className="flex flex-col gap-6">
        <h1 className="text-xl font-semibold">
          {displayName
            ? `${displayName}さん、今日は何を着る？`
            : "今日は何を着る？"}
        </h1>

        {/* 服が0件ならオンボーディング、それ以外は今日のRe:try */}
        {isClosetEmpty ? (
          <OnboardingSteps showRegisterCta />
        ) : (
          outfit && (
            <TodayOutfitCard
              weather={weather}
              suggestion={outfit.suggestion}
              imageUrls={outfit.imageUrls}
            />
          )
        )}
      </div>

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

      <nav
        aria-label="Re:Closet Loop"
        className="flex flex-col gap-2 border-t pt-6 text-sm"
      >
        <Link
          href="/discover"
          className="flex w-fit items-center gap-1 text-muted-foreground hover:text-foreground"
        >
          Re:Closet Loopで誰かのクローゼットをのぞく
          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
        <Link
          href="/protected/likes"
          className="flex w-fit items-center gap-1 text-muted-foreground hover:text-foreground"
        >
          気になる服を見る
          <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      </nav>
    </div>
  );
}

export default function Home() {
  return (
    <main className="min-h-screen flex flex-col items-center">
      <SiteHeader />
      <div className="flex flex-1 w-full flex-col items-center gap-10 px-4 py-8 sm:py-10">
        <Suspense
          fallback={
            <p className="text-sm text-muted-foreground">読み込み中...</p>
          }
        >
          <HomeContent />
        </Suspense>
      </div>
      <SiteFooter />
    </main>
  );
}
