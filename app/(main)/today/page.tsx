import { ClosetSummary } from "@/components/closet-summary";
import { OnboardingSteps } from "@/components/onboarding-steps";
import {
  TodayOutfitCard,
  WeatherAttribution,
} from "@/components/today-outfit-card";
import {
  suggestTodayOutfit,
  type OutfitItemInput,
} from "@/lib/outfit-suggestion";
import { getCurrentDisplayName } from "@/lib/supabase/current-user";
import { createClient } from "@/lib/supabase/server";
import { getJstDateKey, getTodayWeather } from "@/lib/weather";
import { getCurrentSeasonJst, getDaysSinceLastWorn } from "@/lib/wear-logs";
import { ChevronRight, Plus, Recycle } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

export const metadata: Metadata = {
  title: "Today | Re:Closet",
};

const SIGNED_URL_EXPIRES_IN = 600; // 10分

// Today下部の主要導線（同じ見た目で並べる）。
// クローゼット一覧へはサマリーの「登録している服」から開けるため置かない。
const NEXT_LINKS = [
  { href: "/protected/items/new", label: "服を登録する", icon: Plus },
  {
    href: "/discover",
    label: "Loopで誰かのクローゼットをのぞく",
    icon: Recycle,
  },
];

// ログイン後のトップ（天気・今日のRe:try・クローゼットサマリー）。
// 未ログインはproxyで/auth/loginへリダイレクトされる。
async function TodayContent() {
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
      // 今日のコーデ候補の対象（出品中・売却済みは除外、シューズ等は対象外）
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
        console.error("today outfit signed url error:", signError);
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
    console.error("today outfit items error:", outfitItemsResult.error);
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

      <nav aria-label="次にすること" className="flex flex-col gap-2">
        {NEXT_LINKS.map((link) => {
          const Icon = link.icon;
          return (
            <Link
              key={link.href}
              href={link.href}
              className="flex min-h-12 items-center gap-3 rounded-lg border px-4 py-3 text-sm transition-colors hover:bg-accent"
            >
              <Icon
                className="h-5 w-5 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
              <span className="flex-1 font-medium">{link.label}</span>
              <ChevronRight
                className="h-4 w-4 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
            </Link>
          );
        })}
      </nav>

      {/* 天気を表示したときだけ、出典（CC BY 4.0）をページ末尾に小さく示す */}
      {weather && outfit && !isClosetEmpty && <WeatherAttribution />}
    </div>
  );
}

export default function TodayPage() {
  return (
    <div className="flex flex-1 w-full flex-col items-center gap-10 px-4 py-8 sm:py-10">
      <Suspense
        fallback={
          <p className="text-sm text-muted-foreground">読み込み中...</p>
        }
      >
        <TodayContent />
      </Suspense>
    </div>
  );
}
