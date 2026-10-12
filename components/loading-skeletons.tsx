import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

// 一覧・詳細ページのSuspense fallback用。実データのレイアウト（grid列数・gap・
// 正方形の画像枠）に合わせ、読み込み完了時にレイアウトが大きく動かないようにする。

const GRID_VARIANTS = {
  // /protected/items（ClothingItemCard）
  closet: {
    grid: "grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4",
    body: "p-6",
  },
  // /discover（PublicClothingItemCard。スマホは2列・余白小さめ）
  discover: {
    grid: "grid grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4",
    body: "p-3 sm:p-6",
  },
} as const;

const GRID_SKELETON_COUNT = 6;

export function ItemGridSkeleton({
  variant,
}: {
  variant: keyof typeof GRID_VARIANTS;
}) {
  const { grid, body } = GRID_VARIANTS[variant];

  return (
    <div role="status" aria-label="読み込み中" className={grid}>
      {Array.from({ length: GRID_SKELETON_COUNT }, (_, index) => (
        <Card key={index} className="overflow-hidden">
          <Skeleton className="aspect-square w-full rounded-none" />
          <div className={cn("flex flex-col gap-3", body)}>
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
            <div className="flex gap-2">
              <Skeleton className="h-5 w-14" />
              <Skeleton className="h-5 w-10" />
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}

export function ItemDetailSkeleton() {
  return (
    <div role="status" aria-label="読み込み中" className="flex flex-col gap-4">
      <Skeleton className="aspect-square w-full rounded-lg" />

      <Card>
        <div className="flex flex-col gap-3 p-6">
          <Skeleton className="h-7 w-2/3" />
          <Skeleton className="h-4 w-1/3" />
        </div>
        <div className="flex flex-col gap-4 p-6 pt-0">
          <div className="flex gap-2">
            <Skeleton className="h-5 w-16" />
            <Skeleton className="h-5 w-12" />
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-3">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-4 w-20" />
          </div>
        </div>
      </Card>
    </div>
  );
}

// Closet「今日見直す3着」（ReviewSuggestionsCard と同じ枠・3行）
export function ReviewSuggestionsSkeleton() {
  return (
    <div className="flex flex-col gap-3 rounded-xl border bg-muted/30 p-4">
      <div className="flex flex-col gap-1.5">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-3 w-3/4" />
      </div>
      <div className="flex flex-col gap-2">
        {Array.from({ length: 3 }, (_, index) => (
          <Card key={index} className="flex items-center gap-3 p-2.5">
            <Skeleton className="h-16 w-16 shrink-0" />
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-3 w-full" />
            </div>
            <Skeleton className="h-8 w-14 shrink-0" />
          </Card>
        ))}
      </div>
    </div>
  );
}

// Closet の絞り込み（カテゴリ・シーズン・絞り込みの3グループ）
const FILTER_SKELETON_CHIPS = [8, 6, 3];

export function ClosetFilterBarSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      {FILTER_SKELETON_CHIPS.map((count, group) => (
        <div key={group} className="flex flex-col gap-2">
          <Skeleton className="h-3 w-14" />
          <div className="flex flex-wrap gap-2">
            {Array.from({ length: count }, (_, index) => (
              <Skeleton key={index} className="h-8 w-16 rounded-full" />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// Today（挨拶・天気・今日のRe:try 3着・サマリー・導線）
export function TodaySkeleton() {
  return (
    <div className="flex w-full max-w-3xl flex-col gap-10">
      <div className="flex flex-col gap-6">
        <Skeleton className="h-7 w-2/3" />
        <div className="flex flex-col gap-3">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-16 w-full" />
          <div className="grid gap-3 sm:grid-cols-3">
            {Array.from({ length: 3 }, (_, index) => (
              <Card key={index} className="flex gap-3 p-3 sm:flex-col">
                <Skeleton className="h-24 w-24 shrink-0 sm:aspect-square sm:h-auto sm:w-full" />
                <div className="flex flex-1 flex-col gap-2">
                  <Skeleton className="h-5 w-16" />
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-8 w-24" />
                </div>
              </Card>
            ))}
          </div>
        </div>
      </div>
      {/* 今週のRe:Closetは服が0着のときは表示しないため、全体のスケルトンには含めない
          （0着のユーザーに一瞬だけカードの枠が出るのを防ぐ）。服がある場合は
          カードの位置で WeeklyProgressSkeleton を表示する */}
      <div className="flex flex-col gap-3">
        <Skeleton className="h-6 w-40" />
        <div className="grid grid-cols-3 gap-2 sm:gap-4">
          {Array.from({ length: 3 }, (_, index) => (
            <Skeleton key={index} className="h-[5.5rem] rounded-xl" />
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-12 w-full rounded-lg" />
        <Skeleton className="h-12 w-full rounded-lg" />
      </div>
    </div>
  );
}

// Todayの「今週のRe:Closet」（components/weekly-progress-card.tsx）
export function WeeklyProgressSkeleton() {
  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-baseline justify-between">
        <Skeleton className="h-6 w-36" />
        <Skeleton className="h-3 w-14" />
      </div>
      <div className="flex items-baseline justify-between">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-7 w-24" />
      </div>
      <Skeleton className="h-2 w-full rounded-full" />
      <Skeleton className="h-4 w-3/4" />
      <div className="flex items-baseline justify-between border-t pt-3">
        <Skeleton className="h-4 w-16" />
        <Skeleton className="h-5 w-10" />
      </div>
      <Skeleton className="h-3 w-2/3" />
      <div className="grid grid-cols-2 gap-2">
        <Skeleton className="h-10" />
        <Skeleton className="h-10" />
      </div>
    </Card>
  );
}

// 服の登録フォーム（写真・タイトル・カテゴリー・ブランド・シーズン・ボタン）
export function ClothingFormSkeleton() {
  return (
    <Card className="flex flex-col gap-6 p-6">
      <Skeleton className="h-8 w-32" />
      <div className="flex flex-col gap-2">
        <Skeleton className="h-4 w-36" />
        <Skeleton className="h-14 w-full rounded-lg" />
      </div>
      {Array.from({ length: 3 }, (_, index) => (
        <div key={index} className="flex flex-col gap-2">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-9 w-full" />
        </div>
      ))}
      <div className="flex flex-col gap-2">
        <Skeleton className="h-4 w-20" />
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: 5 }, (_, index) => (
            <Skeleton key={index} className="h-9 w-14 rounded-full" />
          ))}
        </div>
      </div>
      <Skeleton className="h-9 w-full" />
    </Card>
  );
}

// 下書き一覧（写真・タイトル・補足・ボタンの行）
export function DraftListSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      {Array.from({ length: 3 }, (_, index) => (
        <Card key={index} className="flex items-center gap-3 p-3">
          <Skeleton className="h-16 w-16 shrink-0" />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-3 w-3/4" />
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <Skeleton className="h-8 w-24" />
            <Skeleton className="h-8 w-14" />
          </div>
        </Card>
      ))}
    </div>
  );
}

// /protected/review/[sessionId]（スワイプ式の見直し）
export function ReviewSessionSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <Skeleton className="h-4 w-16" />
        <Skeleton className="h-8 w-28" />
      </div>
      <Skeleton className="h-1.5 w-full" />
      <Card className="overflow-hidden">
        <Skeleton className="aspect-[4/5] max-h-[60vh] w-full rounded-none" />
        <div className="px-4 py-3">
          <Skeleton className="h-5 w-1/2" />
        </div>
      </Card>
      <div className="grid grid-cols-2 gap-2">
        <Skeleton className="h-10" />
        <Skeleton className="h-10" />
        <Skeleton className="h-9" />
        <Skeleton className="h-9" />
      </div>
    </div>
  );
}
