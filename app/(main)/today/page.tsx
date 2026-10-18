import { ClosetSummary } from "@/components/closet-summary";
import {
  DoodleBook,
  DoodleHangerPlus,
  DoodleLoop,
  DoodleTag,
} from "@/components/doodle-icons";
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
  TodayWeather,
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
import {
  getWeatherRegion,
  WEATHER_REGION_COOKIE,
} from "@/lib/weather-regions";
import { getCurrentSeasonJst, getDaysSinceLastWorn } from "@/lib/wear-logs";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { Suspense } from "react";

export const metadata: Metadata = {
  title: "Today | Re:Closet",
};

// 日付の見出し（例：10月16日(木)）。日本時間で表示する
const TODAY_DATE_FORMAT = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  month: "long",
  day: "numeric",
  weekday: "short",
});

// Todayの主要導線（コーデの下にアイコンで並べる）。
// クローゼット一覧へはサマリーの「登録している服」と下部ナビから開けるため置かない。
// Closetの「今日見直す3着」へは Re:Quest の「1着見直す」から開ける
const QUICK_LINKS = [
  { href: "/protected/items/new", label: "服を登録", icon: DoodleHangerPlus },
  { href: "/protected/review", label: "まとめて見直す", icon: DoodleTag },
  { href: "/protected/story", label: "Re:Story", icon: DoodleBook },
  { href: "/discover", label: "Loop", icon: DoodleLoop },
];

// アイコンの丸は少しずつ形を崩し、手描きの柔らかさを出す
const QUICK_LINK_SHAPES = [
  "rounded-[46%_54%_50%_50%/52%_48%_52%_48%] bg-secondary",
  "rounded-[52%_48%_54%_46%/48%_52%_48%_52%] bg-accent",
  "rounded-[50%_50%_46%_54%/54%_46%_52%_48%] bg-secondary",
  "rounded-[48%_52%_50%_50%/46%_54%_48%_52%] bg-accent",
];

function QuickLinks() {
  return (
    <nav aria-label="すぐにできること">
      <ul className="grid grid-cols-4 gap-1">
        {QUICK_LINKS.map((link, index) => {
          const Icon = link.icon;
          return (
            <li key={link.href}>
              <Link
                href={link.href}
                className="group flex min-h-[5.5rem] flex-col items-center gap-2 rounded-2xl px-1 py-2 text-center outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span
                  className={`flex h-14 w-14 items-center justify-center text-primary transition-transform motion-safe:group-hover:-translate-y-0.5 group-active:scale-95 ${QUICK_LINK_SHAPES[index % QUICK_LINK_SHAPES.length]}`}
                  aria-hidden="true"
                >
                  <Icon size={28} />
                </span>
                <span className="text-[11px] font-medium leading-tight sm:text-xs">
                  {link.label}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

// 今週のRe:Closet（見直し・着用の週次進捗）。Todayの他の表示を待たせないよう、
// 独立したSuspenseで表示する。取得はTodayContentの開始時に並行して始めておき
// （取得の待ち時間が直列にならず、スケルトンの表示が短くなる）、ここで結果を待つ。
// 取得に失敗したら0着ではなくエラーを表示する
// 今週の行動日（曜日の丸）はRe:Questの集計を使う。Re:Questの取得に失敗しても週次の実績は出す
async function WeeklyProgressSection({
  resultPromise,
  reQuestPromise,
}: {
  resultPromise: Promise<WeeklyProgressResult>;
  reQuestPromise: Promise<ReQuestResult>;
}) {
  const [result, reQuest] = await Promise.all([resultPromise, reQuestPromise]);
  return result.ok ? (
    <WeeklyProgressCard
      progress={result.progress}
      weekStartDateKey={result.range.weekStartDateKey}
      goalLoadFailed={result.goalLoadFailed}
      week={reQuest.ok ? reQuest.progress : null}
    />
  ) : (
    <WeeklyProgressError />
  );
}

// ログイン後のトップ（天気・今日のRe:try・導線・Re:Quest・Re:Garden・今週のRe:Closet・サマリー）。
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
  // 天気の地域（Cookieの地域キーを一覧と照合する。未設定・不正な値は未設定として扱う）
  const region = getWeatherRegion(
    (await cookies()).get(WEATHER_REGION_COOKIE)?.value,
  );
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
      // 設定した地域の今日の天気（地域ごとに30分キャッシュ。未設定・失敗時はnull）
      region ? getTodayWeather(region) : Promise.resolve(null),
    ]);

  // 件数の取得に成功し、かつ0件のときだけ初回向けの案内を出す
  // （取得失敗を0件扱いして既存ユーザーに表示しないため）
  const isClosetEmpty = !totalResult.error && totalResult.count === 0;
  const now = new Date();

  // 今日のコーデ候補（服の取得に失敗した場合はカードごと表示しない）
  let outfit: {
    suggestion: ReturnType<typeof suggestTodayOutfit>;
    imageUrls: Map<string, string>;
  } | null = null;

  if (!isClosetEmpty && !outfitItemsResult.error) {
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
      {/* 誌面風のヘッダー（日付・挨拶・天気）。天気は今日のRe:tryを出すときだけ表示する */}
      <header className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <p className="text-xs font-medium tracking-[0.2em] text-primary">
            {TODAY_DATE_FORMAT.format(now)}
          </p>
          <h1 className="text-2xl font-semibold leading-snug sm:text-3xl">
            {displayName
              ? `${displayName}さん、今日は何を着る？`
              : "今日は何を着る？"}
          </h1>
        </div>
        {!isClosetEmpty && outfit && (
          <TodayWeather region={region} weather={weather} />
        )}
      </header>

      {/* 服が0件ならオンボーディング、それ以外は今日のRe:try。
          スマホのファーストビューに、コーデの写真とアイコンの導線が入るように近づけて置く */}
      <div className="flex flex-col gap-6">
        {isClosetEmpty ? (
          <OnboardingSteps showRegisterCta />
        ) : (
          outfit && (
            <TodayOutfitCard
              suggestion={outfit.suggestion}
              imageUrls={outfit.imageUrls}
            />
          )
        )}
        <QuickLinks />
      </div>

      {/* 服が0着のときはオンボーディングを優先し、クエスト・進捗は出さない。
          今日のRe:Quest（今日、何か1つ）のすぐ下にRe:Garden（行動で育つ植物）を置き、
          つながりを配置で見せる → 今週のRe:Closet（週の行動日と見直し目標） */}
      {!isClosetEmpty && (
        <>
          <div className="flex flex-col gap-4">
            <Suspense fallback={<ReQuestSkeleton />}>
              <ReQuestSection resultPromise={reQuestPromise} />
            </Suspense>
            <Suspense fallback={<GardenSkeleton />}>
              <GardenSection resultPromise={gardenPromise} />
            </Suspense>
          </div>
          <Suspense fallback={<WeeklyProgressSkeleton />}>
            <WeeklyProgressSection
              resultPromise={weeklyProgressPromise}
              reQuestPromise={reQuestPromise}
            />
          </Suspense>
        </>
      )}

      <section aria-labelledby="closet-summary-title" className="flex flex-col gap-3">
        <h2 id="closet-summary-title" className="text-lg font-semibold">
          クローゼットサマリー
        </h2>
        <ClosetSummary
          totalCount={totalResult.count ?? 0}
          favoriteCount={favoriteResult.count ?? 0}
          candidateCount={candidateResult.count ?? 0}
        />
      </section>

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
