import { ClosetSummary } from "@/components/closet-summary";
import {
  GardenSkeleton,
  ReQuestSkeleton,
  TodaySkeleton,
  WeeklyProgressSkeleton,
} from "@/components/loading-skeletons";
import { GardenCard, GardenError } from "@/components/garden-card";
import { OnboardingSteps } from "@/components/onboarding-steps";
import { ReQuestCard, ReQuestError } from "@/components/re-quest-card";
import {
  TodayOutfitCard,
  WeatherAttribution,
} from "@/components/today-outfit-card";
import {
  suggestTodayOutfit,
  type OutfitItemInput,
} from "@/lib/outfit-suggestion";
import {
  WeeklyProgressCard,
  WeeklyProgressError,
} from "@/components/weekly-progress-card";
import {
  fetchWeeklyProgress,
  type WeeklyProgressResult,
} from "@/lib/habit-progress-query";
import { fetchGardenGrowth, type GardenResult } from "@/lib/garden-query";
import {
  fetchReQuestProgress,
  type ReQuestResult,
} from "@/lib/re-quest-query";
import {
  getCurrentClaims,
  getCurrentDisplayName,
} from "@/lib/supabase/current-user";
import { createClient } from "@/lib/supabase/server";
import { getPrivateSignedImageUrls } from "@/lib/supabase/signed-image-urls";
import { getJstDateKey, getTodayWeather } from "@/lib/weather";
import { getCurrentSeasonJst, getDaysSinceLastWorn } from "@/lib/wear-logs";
import { ChevronRight, Plus, Recycle } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

export const metadata: Metadata = {
  title: "Today | Re:Closet",
};

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

// 今週のRe:Closet（見直し・着用の週次進捗）。Todayの他の表示を待たせないよう、
// 独立したSuspenseで表示する。取得はTodayContentの開始時に並行して始めておき
// （取得の待ち時間が直列にならず、スケルトンの表示が短くなる）、ここで結果を待つ。
// 取得に失敗したら0着ではなくエラーを表示する
async function WeeklyProgressSection({
  resultPromise,
}: {
  resultPromise: Promise<WeeklyProgressResult>;
}) {
  const result = await resultPromise;
  return result.ok ? (
    <WeeklyProgressCard
      progress={result.progress}
      weekStartDateKey={result.range.weekStartDateKey}
      goalLoadFailed={result.goalLoadFailed}
    />
  ) : (
    <WeeklyProgressError />
  );
}

// ログイン後のトップ（天気・今日のRe:try・今週のRe:Closet・クローゼットサマリー）。
// 未ログインはproxyで/auth/loginへリダイレクトされる。
async function ReQuestSection({
  resultPromise,
}: {
  resultPromise: Promise<ReQuestResult>;
}) {
  const result = await resultPromise;
  return result.ok ? <ReQuestCard progress={result.progress} /> : <ReQuestError />;
}

async function GardenSection({
  resultPromise,
}: {
  resultPromise: Promise<GardenResult>;
}) {
  const [result, claims] = await Promise.all([resultPromise, getCurrentClaims()]);
  return result.ok ? (
    <GardenCard growth={result.growth} userId={claims?.sub ?? null} />
  ) : (
    <GardenError />
  );
}

async function TodayContent() {
  const supabase = await createClient();
  // 週次進捗・Re:Questは他の取得と並行して始める（例外は投げず、失敗は ok:false で返る）。
  // 服が0着なら表示しないため、結果は使わずに終わる
  const weeklyProgressPromise = fetchWeeklyProgress(supabase);
  const reQuestPromise = fetchReQuestProgress(supabase);
  const gardenPromise = fetchGardenGrowth(supabase);
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
          "id, title, brand, category, seasons, status, favorite, last_worn_at, clothing_images(image_path, sort_order)",
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
        seasons: item.seasons ?? [],
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
    const claims = await getCurrentClaims();
    const urlByPath = await getPrivateSignedImageUrls(
      supabase,
      claims?.sub,
      pickPaths,
      "today outfit",
    );
    for (const pick of suggestion.picks) {
      const url = pick.item.imagePath
        ? urlByPath.get(pick.item.imagePath)
        : undefined;
      if (url) imageUrls.set(pick.item.id, url);
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

      {/* 服が0着のときはオンボーディングを優先し、クエスト・進捗は出さない。
          今日のRe:Quest（今日、何か1つ）→ Re:Garden（行動で育つ植物）
          → 今週のRe:Closet（週の見直し目標）の順 */}
      {!isClosetEmpty && (
        <div className="flex flex-col gap-6">
          <Suspense fallback={<ReQuestSkeleton />}>
            <ReQuestSection resultPromise={reQuestPromise} />
          </Suspense>
          <Suspense fallback={<GardenSkeleton />}>
            <GardenSection resultPromise={gardenPromise} />
          </Suspense>
          <Suspense fallback={<WeeklyProgressSkeleton />}>
            <WeeklyProgressSection resultPromise={weeklyProgressPromise} />
          </Suspense>
        </div>
      )}

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
      <Suspense fallback={<TodaySkeleton />}>
        <TodayContent />
      </Suspense>
    </div>
  );
}
