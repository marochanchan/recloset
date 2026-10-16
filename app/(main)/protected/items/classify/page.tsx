import {
  ClothingClassifySession,
  type ClassifyItem,
} from "@/components/clothing-classify-session";
import { ReviewSessionSkeleton } from "@/components/loading-skeletons";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  CLASSIFY_MODE_LABELS,
  CLASSIFY_STATUSES,
  isClassifyMode,
  MAX_CLASSIFY_ITEMS,
  selectClassifyItems,
  type ClassifyMode,
} from "@/lib/clothing-classify";
import {
  normalizeSeasons,
  PHOTO_ONLY_CATEGORY,
  PHOTO_ONLY_TITLE,
} from "@/lib/clothing-options";
import { getCurrentClaims } from "@/lib/supabase/current-user";
import { createClient } from "@/lib/supabase/server";
import { getPrivateSignedImageUrls } from "@/lib/supabase/signed-image-urls";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

export const metadata: Metadata = {
  title: "クイック仕分け | Re:Closet",
};

type SearchParams = Promise<{ mode?: string | string[]; r?: string | string[] }>;

const firstParam = (value: string | string[] | undefined) =>
  Array.isArray(value) ? value[0] : value;

type Supabase = Awaited<ReturnType<typeof createClient>>;

// 未分類の服の絞り込み（RLSにより本人の服だけが返る）。
// カテゴリ: 写真だけ登録したままで、分類した記録がない服（lib/clothing-classify.ts参照）
// 季節: seasons が空配列の服
const unclassifiedFilters = (
  mode: ClassifyMode,
): [column: string, operator: string, value: string][] =>
  mode === "category"
    ? [
        ["title", "eq", PHOTO_ONLY_TITLE],
        ["category", "eq", PHOTO_ONLY_CATEGORY],
        ["category_classified_at", "is", "null"],
      ]
    : [["seasons", "eq", "{}"]];

async function countUnclassified(supabase: Supabase, mode: ClassifyMode) {
  let query = supabase
    .from("clothing_items")
    .select("*", { count: "exact", head: true })
    .in("status", [...CLASSIFY_STATUSES]);
  for (const [column, operator, value] of unclassifiedFilters(mode)) {
    query = query.filter(column, operator, value);
  }
  const { count, error } = await query;
  if (error) {
    console.error("count unclassified items error:", error);
    return null;
  }
  return count ?? 0;
}

// ---- モード選択 ----
async function ClassifyMenu() {
  const supabase = await createClient();
  const [categoryCount, seasonCount] = await Promise.all([
    countUnclassified(supabase, "category"),
    countUnclassified(supabase, "season"),
  ]);

  const modes: {
    mode: ClassifyMode;
    count: number | null;
    description: string;
  }[] = [
    {
      mode: "category",
      count: categoryCount,
      description: "写真だけで登録した服に、トップス・ボトムスなどを付けます",
    },
    {
      mode: "season",
      count: seasonCount,
      description: "季節が未設定の服に、春・夏・秋・冬を付けます",
    },
  ];

  return (
    <div className="flex flex-col gap-3">
      {modes.map(({ mode, count, description }) => (
        <Card key={mode} className="flex flex-col gap-3 p-4">
          <div className="flex flex-col gap-1">
            <h2 className="text-base font-semibold">{CLASSIFY_MODE_LABELS[mode]}</h2>
            <p className="text-sm text-muted-foreground">{description}</p>
            {count !== null && (
              <p className="text-sm">
                {count > 0 ? `未分類 ${count}着` : "未分類の服はありません"}
              </p>
            )}
          </div>
          {count !== 0 && (
            <Button asChild className="min-h-11">
              <Link href={`/protected/items/classify?mode=${mode}`}>
                {count !== null && count > MAX_CLASSIFY_ITEMS
                  ? `${MAX_CLASSIFY_ITEMS}着だけ始める`
                  : "始める"}
              </Link>
            </Button>
          )}
        </Card>
      ))}
    </div>
  );
}

function ClassifyMenuSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      {[0, 1].map((key) => (
        <Card key={key} className="flex flex-col gap-3 p-4">
          <Skeleton className="h-5 w-1/2" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-11 w-full" />
        </Card>
      ))}
    </div>
  );
}

// ---- 仕分け ----
async function ClassifyContent({ mode }: { mode: ClassifyMode }) {
  const supabase = await createClient();
  let query = supabase
    .from("clothing_items")
    .select(
      "id, title, status, category, subcategory, seasons, category_classified_at, created_at, clothing_images(image_path, sort_order)",
    )
    .in("status", [...CLASSIFY_STATUSES]);
  for (const [column, operator, value] of unclassifiedFilters(mode)) {
    query = query.filter(column, operator, value);
  }
  const { data, error } = await query
    .order("created_at", { ascending: false })
    .limit(MAX_CLASSIFY_ITEMS);
  if (error) throw error;

  // DB側の絞り込みに加えて、同じ判定・並び順を純粋関数でも確かめる
  const itemIds = selectClassifyItems(
    mode,
    data.map((item) => ({
      id: item.id,
      title: item.title,
      category: item.category,
      status: item.status,
      seasons: item.seasons,
      categoryClassifiedAt: item.category_classified_at ?? null,
      createdAt: item.created_at,
    })),
  );

  if (itemIds.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl bg-secondary/60 px-6 py-12 text-center">
        <p className="text-sm text-muted-foreground">
          {mode === "category"
            ? "カテゴリが未分類の服はありません"
            : "季節が未設定の服はありません"}
        </p>
        <Button asChild variant="outline">
          <Link href="/protected/items/classify">仕分けメニューへ</Link>
        </Button>
      </div>
    );
  }

  // 服ごとの代表画像（sort_orderが最小の1枚）
  const coverPathByItem = new Map<string, string>();
  for (const item of data) {
    const cover = [...(item.clothing_images ?? [])].sort(
      (a, b) => a.sort_order - b.sort_order,
    )[0];
    if (cover) coverPathByItem.set(item.id, cover.image_path);
  }
  const claims = await getCurrentClaims();
  const urlByPath = await getPrivateSignedImageUrls(
    supabase,
    claims?.sub,
    [...coverPathByItem.values()],
    "classify",
  );

  const itemById = new Map(data.map((item) => [item.id, item]));
  const items: ClassifyItem[] = itemIds.flatMap((id) => {
    const item = itemById.get(id);
    if (!item) return [];
    const coverPath = coverPathByItem.get(id);
    return [
      {
        id,
        title: item.title,
        imageUrl: coverPath ? (urlByPath.get(coverPath) ?? null) : null,
        category: item.category,
        subcategory: item.subcategory ?? null,
        seasons: normalizeSeasons(item.seasons),
      },
    ];
  });

  return <ClothingClassifySession mode={mode} initialItems={items} />;
}

async function ClassifyPageContent({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const params = await searchParams;
  const mode = firstParam(params.mode);
  if (!isClassifyMode(mode)) return <ClassifyMenu />;
  // 「もう少し仕分ける」で始め直すときは r が変わり、仕分けの状態を作り直す
  const round = firstParam(params.r) ?? "";
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        {CLASSIFY_MODE_LABELS[mode]}
      </p>
      <Suspense key={`${mode}:${round}`} fallback={<ReviewSessionSkeleton />}>
        <ClassifyContent mode={mode} />
      </Suspense>
    </div>
  );
}

export default function ClothingClassifyPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  return (
    <div className="w-full max-w-md mx-auto flex flex-col gap-4">
      <Link
        href="/protected/items"
        className="text-sm underline underline-offset-4 text-muted-foreground w-fit"
      >
        ← クローゼットに戻る
      </Link>
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold">クイック仕分け</h1>
        <p className="text-xs text-muted-foreground">
          写真を見ながら、カテゴリや季節をタップで付けていきます。一度に全部やらなくて大丈夫です。
        </p>
      </div>
      <Suspense fallback={<ClassifyMenuSkeleton />}>
        <ClassifyPageContent searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
