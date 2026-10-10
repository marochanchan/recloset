import { ClothingItemCard } from "@/components/clothing-item-card";
import { ItemGridSkeleton } from "@/components/loading-skeletons";
import { Button } from "@/components/ui/button";
import {
  CLOSET_FILTER_PATH,
  buildClosetFilterHref,
  hasActiveClosetFilters,
  parseClosetFilters,
  type ClosetFilters,
  type RawSearchParams,
} from "@/lib/closet-filters";
import { CATEGORY_OPTIONS, SEASON_OPTIONS } from "@/lib/clothing-options";
import { createClient } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { Suspense } from "react";

const SIGNED_URL_EXPIRES_IN = 600; // 10分

type SearchParamsPromise = Promise<RawSearchParams>;

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
        "inline-flex h-8 items-center rounded-full border px-3 text-sm transition-colors",
        selected
          ? "border-primary bg-primary font-medium text-primary-foreground"
          : "text-muted-foreground hover:bg-accent hover:text-foreground",
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

// カテゴリ・シーズンの絞り込み（URLの ?category= / ?season= を切り替えるリンク）
async function ClosetFilterBar({
  searchParams,
}: {
  searchParams: SearchParamsPromise;
}) {
  const rawParams = await searchParams;
  const filters = parseClosetFilters(rawParams);
  const hrefFor = (change: Partial<ClosetFilters>) =>
    buildClosetFilterHref(rawParams, filters, change);

  return (
    <div className="flex flex-col gap-4">
      <FilterGroup label="カテゴリ">
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
      </FilterGroup>
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
      <FilterGroup label="絞り込み">
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
      "id, title, brand, category, season, favorite, status, last_worn_at, is_public, clothing_images(image_path, sort_order)",
    );
  if (filters.category) query = query.eq("category", filters.category);
  if (filters.season) query = query.eq("season", filters.season);
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
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed px-4 py-10 text-center">
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
      <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed px-4 py-10 text-center">
        <p className="font-medium">まだ服が登録されていません</p>
        <p className="text-sm text-muted-foreground">
          手持ちの服を登録すると、ここに並びます。
        </p>
        <Button asChild variant="outline" size="sm">
          <Link href="/protected/items/new">服を登録する</Link>
        </Button>
      </div>
    );
  }

  const representativePaths = items
    .map((item) => item.clothing_images[0]?.image_path)
    .filter((path): path is string => Boolean(path));

  const signedUrlMap = new Map<string, string>();

  if (representativePaths.length > 0) {
    const { data: signedUrls, error: signError } = await supabase.storage
      .from("clothing-images")
      .createSignedUrls(representativePaths, SIGNED_URL_EXPIRES_IN);

    if (signError) {
      console.error("clothing image signed url error:", signError);
    } else {
      for (const entry of signedUrls) {
        if (entry.error || !entry.path || !entry.signedUrl) {
          console.error("clothing image signed url entry error:", entry);
          continue;
        }
        signedUrlMap.set(entry.path, entry.signedUrl);
      }
    }
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {items.map((item) => {
        const representativePath = item.clothing_images[0]?.image_path ?? null;
        const imageUrl = representativePath
          ? (signedUrlMap.get(representativePath) ?? null)
          : null;

        return (
          <Link
            key={item.id}
            href={`/protected/items/${item.id}`}
            className="block h-full"
          >
            <ClothingItemCard
              title={item.title}
              brand={item.brand}
              category={item.category}
              season={item.season}
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

export default function ClothingItemsPage({
  searchParams,
}: {
  searchParams: SearchParamsPromise;
}) {
  return (
    <div className="w-full flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">クローゼット一覧</h1>
        <Button asChild>
          <Link href="/protected/items/new">服を登録</Link>
        </Button>
      </div>

      <Suspense fallback={null}>
        <ClosetFilterBar searchParams={searchParams} />
      </Suspense>

      <Suspense fallback={<ItemGridSkeleton variant="closet" />}>
        <ClothingItemsList searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
