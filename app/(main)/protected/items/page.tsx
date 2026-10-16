import { ClothingItemCard } from "@/components/clothing-item-card";
import { ClosetNotice } from "@/components/draft-saved-notice";
import { ReviewSuggestionsCard } from "@/components/review-suggestions-card";
import {
  ClosetFilterBarSkeleton,
  ItemGridSkeleton,
  ReviewSuggestionsSkeleton,
} from "@/components/loading-skeletons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  CLOSET_FILTER_PATH,
  buildClosetFilterHref,
  hasActiveClosetFilters,
  parseClosetFilters,
  type ClosetFilters,
  type RawSearchParams,
} from "@/lib/closet-filters";
import {
  CATEGORY_OPTIONS,
  SEASON_OPTIONS,
  SEASON_VALUES,
} from "@/lib/clothing-options";
import {
  selectReviewSuggestions,
  type ReviewDecision,
  type ReviewItemInput,
} from "@/lib/review-suggestions";
import { getCurrentClaims } from "@/lib/supabase/current-user";
import { createClient } from "@/lib/supabase/server";
import { getPrivateSignedImageUrls } from "@/lib/supabase/signed-image-urls";
import { cn } from "@/lib/utils";
import { getJstDateKey } from "@/lib/weather";
import { getCurrentSeasonJst } from "@/lib/wear-logs";
import { Camera, ChevronDown, FileText, Layers, Plus, SlidersHorizontal, Tags } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";

type SearchParamsPromise = Promise<RawSearchParams>;

// 詳細へ移動できる衣類カード。押せることが伝わるよう、hover・キーボード操作・タップに反応させる
const CLICKABLE_CARD_LINK_CLASS =
  "group block h-full rounded-xl outline-none transition-transform focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 focus-visible:ring-offset-background active:scale-[0.98]";

// 空状態（服が0着・条件に合う服がない）の枠
const EMPTY_STATE_CLASS =
  "flex flex-col items-center gap-3 rounded-2xl bg-secondary/60 px-6 py-12 text-center";

// 「その他の登録方法」の中の1行
const MORE_REGISTER_LINK_CLASS =
  "flex min-h-12 items-center gap-3 rounded-lg px-3 py-2 text-sm outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring active:bg-accent";

function FilterChip({
  href,
  label,
  selected,
}: {
  href: string;
  label: string;
  selected: boolean;
}) {
  return (
    <Link
      href={href}
      scroll={false}
      aria-current={selected ? "true" : undefined}
      className={cn(
        "inline-flex h-9 shrink-0 items-center whitespace-nowrap rounded-full border px-3.5 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
        selected
          ? "border-primary bg-primary font-medium text-primary-foreground"
          : "border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      {label}
    </Link>
  );
}

function FilterGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-col gap-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

// カテゴリ・シーズンの絞り込み（URLの ?category= / ?season= を切り替えるリンク）。
// よく使うカテゴリは1行の横スクロールで常に見せ、季節・お気に入り・手放し候補は
// 「季節・状態」に折りたたむ（どれかを選んでいるときは開いた状態で表示する）
async function ClosetFilterBar({
  searchParams,
}: {
  searchParams: SearchParamsPromise;
}) {
  const rawParams = await searchParams;
  const filters = parseClosetFilters(rawParams);
  const hrefFor = (change: Partial<ClosetFilters>) =>
    buildClosetFilterHref(rawParams, filters, change);

  // 折りたたみの見出しに、選択中の条件を短く出す
  const secondaryLabels = [
    filters.season
      ? SEASON_OPTIONS.find((option) => option.value === filters.season)?.label
      : null,
    filters.favorite ? "お気に入り" : null,
    filters.status === "candidate" ? "手放し候補" : null,
  ].filter((label): label is string => Boolean(label));
  const hasSecondaryFilters = secondaryLabels.length > 0;

  return (
    <div className="flex flex-col gap-2">
      {/* スマホでは画面の端まで横スクロールさせる（親の余白 p-5 を打ち消す） */}
      <div
        role="group"
        aria-label="カテゴリ"
        className="-mx-5 flex gap-2 overflow-x-auto px-5 py-1 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 [&::-webkit-scrollbar]:hidden"
      >
        <FilterChip
          href={hrefFor({ category: null })}
          label="すべて"
          selected={filters.category === null}
        />
        {CATEGORY_OPTIONS.map((option) => (
          <FilterChip
            key={option.value}
            href={hrefFor({ category: option.value })}
            label={option.label}
            selected={filters.category === option.value}
          />
        ))}
      </div>

      <div className="flex flex-wrap items-start justify-between gap-x-3">
        <details className="group/filters min-w-0 flex-1" open={hasSecondaryFilters}>
          <summary className="flex min-h-10 w-fit cursor-pointer list-none items-center gap-1.5 rounded-lg pr-2 text-sm text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
            <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
            季節・状態で絞り込む
            {hasSecondaryFilters && (
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                {secondaryLabels.join("・")}
              </span>
            )}
            <ChevronDown
              className="h-4 w-4 transition-transform group-open/filters:rotate-180"
              aria-hidden="true"
            />
          </summary>
          <div className="flex flex-col gap-3 pb-2 pt-2">
            <FilterGroup label="シーズン">
              <FilterChip
                href={hrefFor({ season: null })}
                label="すべて"
                selected={filters.season === null}
              />
              {SEASON_OPTIONS.map((option) => (
                <FilterChip
                  key={option.value}
                  href={hrefFor({ season: option.value })}
                  label={option.label}
                  selected={filters.season === option.value}
                />
              ))}
            </FilterGroup>
            <FilterGroup label="状態">
              <FilterChip
                href={hrefFor({ favorite: false, status: null })}
                label="すべて"
                selected={!filters.favorite && filters.status === null}
              />
              <FilterChip
                href={hrefFor({ favorite: true, status: null })}
                label="お気に入り"
                selected={filters.favorite}
              />
              <FilterChip
                href={hrefFor({ favorite: false, status: "candidate" })}
                label="手放し候補"
                selected={filters.status === "candidate"}
              />
            </FilterGroup>
          </div>
        </details>
        {hasActiveClosetFilters(filters) && (
          <Link
            href={CLOSET_FILTER_PATH}
            scroll={false}
            className="flex min-h-10 items-center text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
          >
            すべて解除
          </Link>
        )}
      </div>
    </div>
  );
}

async function ClothingItemsList({
  searchParams,
}: {
  searchParams: SearchParamsPromise;
}) {
  const filters = parseClosetFilters(await searchParams);
  const supabase = await createClient();

  // 絞り込みは検証済みの値（clothing-options.tsの定義と完全一致）だけをクエリに渡す
  let query = supabase
    .from("clothing_items")
    .select(
      "id, title, brand, category, seasons, favorite, status, last_worn_at, is_public, clothing_images(image_path, sort_order)",
    );
  if (filters.category) query = query.eq("category", filters.category);
  // 季節は「その季節を含む服」で絞り込む。オールシーズンは4季節すべてを含む服
  if (filters.season) {
    query = query.contains(
      "seasons",
      filters.season === "all" ? [...SEASON_VALUES] : [filters.season],
    );
  }
  if (filters.favorite) query = query.eq("favorite", true);
  if (filters.status) query = query.eq("status", filters.status);

  const { data: items, error } = await query
    .order("created_at", { ascending: false })
    .order("sort_order", { referencedTable: "clothing_images" });

  if (error) {
    throw error;
  }

  if (items.length === 0 && hasActiveClosetFilters(filters)) {
    // 服はあるが条件に合わないのか、服自体が0件なのかを区別する
    const { count, error: countError } = await supabase
      .from("clothing_items")
      .select("*", { count: "exact", head: true });
    if (countError) {
      console.error("closet total count error:", countError);
    }
    if (countError || (count ?? 0) > 0) {
      return (
        <div className={EMPTY_STATE_CLASS}>
          <p className="font-medium">条件に合う服がありません</p>
          <Button asChild variant="outline" size="sm">
            <Link href={CLOSET_FILTER_PATH} scroll={false}>
              絞り込みを解除
            </Link>
          </Button>
        </div>
      );
    }
  }

  if (items.length === 0) {
    return (
      <div className={EMPTY_STATE_CLASS}>
        <p className="font-medium">まだ服が登録されていません</p>
        <p className="text-sm text-muted-foreground">
          手持ちの服を登録すると、ここに並びます。
        </p>
        <Button asChild size="sm">
          <Link href="/protected/items/new?mode=photo">
            <Camera aria-hidden="true" />
            写真だけで登録
          </Link>
        </Button>
        <Link
          href="/protected/items/new"
          className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground"
        >
          1着ずつ詳しく登録する
        </Link>
      </div>
    );
  }

  const representativePaths = items
    .map((item) => item.clothing_images[0]?.image_path)
    .filter((path): path is string => Boolean(path));

  const claims = await getCurrentClaims();
  const signedUrlMap = await getPrivateSignedImageUrls(
    supabase,
    claims?.sub,
    representativePaths,
    "closet list",
  );

  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-3 sm:gap-x-4 lg:grid-cols-4">
      {items.map((item) => {
        const representativePath = item.clothing_images[0]?.image_path ?? null;
        const imageUrl = representativePath
          ? (signedUrlMap.get(representativePath) ?? null)
          : null;

        return (
          <Link
            key={item.id}
            href={`/protected/items/${item.id}`}
            className={CLICKABLE_CARD_LINK_CLASS}
          >
            <ClothingItemCard
              title={item.title}
              brand={item.brand}
              category={item.category}
              seasons={item.seasons ?? []}
              favorite={item.favorite}
              status={item.status}
              lastWornAt={item.last_worn_at}
              isPublic={item.is_public}
              imageUrl={imageUrl}
            />
          </Link>
        );
      })}
    </div>
  );
}

// 候補を選ぶために読む服の上限（画像は読まず、必要な列だけ）。
// 超える場合は登録の古い順に1000着までを対象にする
const REVIEW_ITEMS_LIMIT = 1000;
const REVIEW_DIAGNOSES_LIMIT = 2000;

// 「今日見直す3着」。絞り込み中は案内も含めて出さない。
// 取得に失敗した場合はカードごと出さない（Closet一覧はそのまま使える）
// 絞り込み中は、読み込み中のスケルトンも含めて出さない
async function ReviewSuggestionsSection({
  searchParams,
}: {
  searchParams: SearchParamsPromise;
}) {
  if (hasActiveClosetFilters(parseClosetFilters(await searchParams))) {
    return null;
  }
  return (
    <Suspense fallback={<ReviewSuggestionsSkeleton />}>
      <ReviewSuggestions />
    </Suspense>
  );
}

async function ReviewSuggestions() {
  const supabase = await createClient();
  const [totalResult, itemsResult, diagnosesResult] = await Promise.all([
    supabase
      .from("clothing_items")
      .select("*", { count: "exact", head: true }),
    supabase
      .from("clothing_items")
      .select("id, title, status, seasons, favorite, last_worn_at, purchase_date")
      .in("status", ["closet", "candidate"])
      .order("created_at", { ascending: true })
      .limit(REVIEW_ITEMS_LIMIT),
    // 新しい順に読み、服ごとに最初の1件を最新の診断として使う
    supabase
      .from("ai_diagnoses")
      .select("clothing_item_id, decision, created_at")
      .order("created_at", { ascending: false })
      .limit(REVIEW_DIAGNOSES_LIMIT),
  ]);

  if (totalResult.error || itemsResult.error || diagnosesResult.error) {
    console.error(
      "review suggestions fetch error:",
      totalResult.error ?? itemsResult.error ?? diagnosesResult.error,
    );
    return null;
  }

  const latestDiagnosisByItem = new Map<
    string,
    { decision: ReviewDecision; createdAt: string }
  >();
  for (const diagnosis of diagnosesResult.data) {
    if (!latestDiagnosisByItem.has(diagnosis.clothing_item_id)) {
      latestDiagnosisByItem.set(diagnosis.clothing_item_id, {
        decision: diagnosis.decision as ReviewDecision,
        createdAt: diagnosis.created_at,
      });
    }
  }

  const items: ReviewItemInput[] = itemsResult.data.map((item) => ({
    id: item.id,
    title: item.title,
    status: item.status,
    seasons: item.seasons ?? [],
    favorite: item.favorite,
    lastWornAt: item.last_worn_at,
    purchaseDate: item.purchase_date ?? null,
    latestDiagnosis: latestDiagnosisByItem.get(item.id) ?? null,
  }));

  const now = new Date();
  const suggestions = selectReviewSuggestions({
    items,
    now,
    dateKey: getJstDateKey(now),
    currentSeason: getCurrentSeasonJst(now),
  });

  // 選んだ服の代表画像（sort_orderが最小の1枚）だけ署名付きURLを発行する
  const imageUrls = new Map<string, string>();
  if (suggestions.length > 0) {
    const { data: images, error: imagesError } = await supabase
      .from("clothing_images")
      .select("clothing_item_id, image_path, sort_order")
      .in(
        "clothing_item_id",
        suggestions.map((suggestion) => suggestion.item.id),
      )
      .order("sort_order");
    if (imagesError) {
      console.error("review suggestion images error:", imagesError);
    } else {
      const coverPathByItem = new Map<string, string>();
      for (const image of images) {
        if (!coverPathByItem.has(image.clothing_item_id)) {
          coverPathByItem.set(image.clothing_item_id, image.image_path);
        }
      }
      const claims = await getCurrentClaims();
      const urlByPath = await getPrivateSignedImageUrls(
        supabase,
        claims?.sub,
        [...coverPathByItem.values()],
        "review suggestion",
      );
      for (const [itemId, path] of coverPathByItem) {
        const url = urlByPath.get(path);
        if (url) imageUrls.set(itemId, url);
      }
    }
  }

  return (
    <ReviewSuggestionsCard
      suggestions={suggestions}
      imageUrls={imageUrls}
      totalItemCount={totalResult.count ?? 0}
    />
  );
}

// 下書きがあるときだけ、「下書き N」の小さなボタンを出す。
// 件数を取得できない場合（下書きテーブルの適用前など）は何も出さない。
// 見出しの横に出すため、読み込み後に下の内容を押し下げない
async function DraftsButton() {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from("clothing_item_drafts")
    .select("*", { count: "exact", head: true });
  if (error || !count) return null;
  return (
    <Button asChild variant="outline" size="sm" className="h-9 shrink-0 rounded-full px-3">
      <Link href="/protected/items/drafts">
        <FileText aria-hidden="true" />
        下書き
        <Badge variant="secondary" className="px-1.5">
          {count}
        </Badge>
      </Link>
    </Button>
  );
}

export default function ClothingItemsPage({
  searchParams,
}: {
  searchParams: SearchParamsPromise;
}) {
  return (
    <div className="w-full flex flex-col gap-6">
      {/* 主要な操作は「写真だけで登録」と「まとめて見直す」の2つを横に並べる。
          スマホで服の写真が早く見えるよう、クイック仕分け・1着ずつの登録は
          「その他の登録方法」に折りたたむ。下書きがあるときは見出しの横に小さく出す */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-2xl font-bold">クローゼット</h1>
          <Suspense fallback={null}>
            <DraftsButton />
          </Suspense>
        </div>
        <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:gap-3">
          <div className="grid grid-cols-2 gap-2 sm:flex">
            {/* 写真を選ぶだけで、1着でもまとめてでも登録できる入口（いちばん手軽な始め方） */}
            <Button asChild size="lg" className="h-12 px-3 sm:h-10 sm:px-6">
              <Link href="/protected/items/new?mode=photo">
                <Camera aria-hidden="true" />
                写真だけで登録
              </Link>
            </Button>
            {/* 1着ずつスワイプで見直す（最大10着。開始・再開は見直しの画面で選ぶ） */}
            <Button asChild variant="outline" size="lg" className="h-12 px-3 sm:h-10 sm:px-6">
              <Link href="/protected/review">
                <Layers aria-hidden="true" />
                まとめて見直す
              </Link>
            </Button>
          </div>
          <details className="group/more sm:relative">
            <summary className="flex min-h-10 w-fit cursor-pointer list-none items-center gap-1 rounded-lg px-1 text-sm text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
              その他の登録方法
              <ChevronDown
                className="h-4 w-4 transition-transform group-open/more:rotate-180"
                aria-hidden="true"
              />
            </summary>
            <div className="mt-1 flex flex-col rounded-xl border border-border/70 bg-card p-1 sm:absolute sm:left-0 sm:z-20 sm:w-72 sm:shadow-lg">
              {/* 写真だけで登録した服などに、カテゴリ・季節をカードで付けていく入口 */}
              <Link href="/protected/items/classify" className={MORE_REGISTER_LINK_CLASS}>
                <Tags className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                <span className="flex flex-col">
                  <span className="font-medium">クイック仕分け</span>
                  <span className="text-xs text-muted-foreground">
                    カテゴリや季節をサクッと整理
                  </span>
                </span>
              </Link>
              <Link href="/protected/items/new" className={MORE_REGISTER_LINK_CLASS}>
                <Plus className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                <span className="flex flex-col">
                  <span className="font-medium">服を登録</span>
                  <span className="text-xs text-muted-foreground">
                    1着ずつ、詳しく入力して登録
                  </span>
                </span>
              </Link>
            </div>
          </details>
        </div>
      </div>

      <ClosetNotice />

      <Suspense fallback={null}>
        <ReviewSuggestionsSection searchParams={searchParams} />
      </Suspense>

      <Suspense fallback={<ClosetFilterBarSkeleton />}>
        <ClosetFilterBar searchParams={searchParams} />
      </Suspense>

      <Suspense fallback={<ItemGridSkeleton variant="closet" />}>
        <ClothingItemsList searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
