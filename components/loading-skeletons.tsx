import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

// 一覧・詳細ページのSuspense fallback用。実データのレイアウト（grid列数・gap・
// 正方形の画像枠）に合わせ、読み込み完了時にレイアウトが大きく動かないようにする。

const GRID_SKELETON_COUNT = 6;

// /protected/items（ClothingItemCard）・/discover（PublicClothingItemCard）は、
// どちらも枠なし・縦長4:5の写真（スマホ2列 → 3列 → 4列）
export function ItemGridSkeleton({
  variant,
}: {
  variant: "closet" | "discover";
}) {
  return (
    <div
      role="status"
      aria-label="読み込み中"
      data-variant={variant}
      className="grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-3 sm:gap-x-4 lg:grid-cols-4"
    >
      {Array.from({ length: GRID_SKELETON_COUNT }, (_, index) => (
        <div key={index} className="flex flex-col gap-2">
          <Skeleton className="aspect-[4/5] w-full rounded-xl" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      ))}
    </div>
  );
}

export function ItemDetailSkeleton() {
  return (
    <div role="status" aria-label="読み込み中" className="flex flex-col gap-8">
      <div className="flex flex-col gap-5">
        <Skeleton className="aspect-[4/5] w-full rounded-2xl" />
        <div className="flex flex-col gap-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-7 w-2/3" />
            </div>
            <Skeleton className="h-9 w-24 rounded-full" />
          </div>
          <div className="flex gap-1.5">
            <Skeleton className="h-5 w-16 rounded-full" />
            <Skeleton className="h-5 w-12 rounded-full" />
            <Skeleton className="h-5 w-14 rounded-full" />
          </div>
        </div>
        <Skeleton className="h-9 w-full" />
      </div>
      <div className="flex flex-col gap-3">
        <Skeleton className="h-5 w-32" />
        <div className="grid grid-cols-2 gap-2">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="h-9" />
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-3">
        <Skeleton className="h-5 w-12" />
        <Skeleton className="h-44 w-full rounded-2xl" />
      </div>
    </div>
  );
}

// Closet「今日見直す3着」（ReviewSuggestionsCard と同じ並び。スマホは横スクロール・広い画面は3列）
export function ReviewSuggestionsSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-3 w-3/4" />
      </div>
      <div className="-mx-5 flex gap-3 overflow-hidden px-5 pb-1 sm:mx-0 sm:grid sm:grid-cols-3 sm:px-0 sm:pb-0">
        {Array.from({ length: 3 }, (_, index) => (
          <div
            key={index}
            className="flex w-[36%] min-w-[7.5rem] shrink-0 flex-col gap-2 sm:w-auto sm:min-w-0"
          >
            <Skeleton className="aspect-square w-full rounded-xl" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

// Closet の絞り込み（カテゴリの横並び＋「季節・状態」の折りたたみ）
export function ClosetFilterBarSkeleton() {
  return (
    <div className="flex flex-col gap-2">
      <div className="-mx-5 flex gap-2 overflow-hidden px-5 py-1 sm:mx-0 sm:px-0">
        {Array.from({ length: 7 }, (_, index) => (
          <Skeleton key={index} className="h-9 w-16 shrink-0 rounded-full" />
        ))}
      </div>
      <Skeleton className="my-2.5 h-5 w-40" />
    </div>
  );
}

// Today（日付・挨拶・天気のヘッダー → 今日のRe:try → サマリー → 導線）
export function TodaySkeleton() {
  return (
    <div className="flex w-full max-w-3xl flex-col gap-12">
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-8 w-3/4" />
        </div>
        <div className="flex items-center gap-3">
          <Skeleton className="h-10 w-10 rounded-full" />
          <div className="flex flex-col gap-1.5">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-4 w-44" />
          </div>
        </div>
      </div>
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-4 w-full" />
        </div>
        <div className="-mx-4 flex gap-3 overflow-hidden px-4 sm:mx-0 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-0">
          {Array.from({ length: 3 }, (_, index) => (
            <div
              key={index}
              className="flex w-[46%] min-w-[9.5rem] shrink-0 flex-col gap-2.5 sm:w-auto sm:min-w-0"
            >
              <Skeleton className="aspect-[4/5] w-full rounded-xl" />
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-8 w-24" />
            </div>
          ))}
        </div>
      </div>
      {/* 今週のRe:Closetは服が0着のときは表示しないため、全体のスケルトンには含めない
          （0着のユーザーに一瞬だけ枠が出るのを防ぐ）。服がある場合は
          その位置で WeeklyProgressSkeleton を表示する */}
      <div className="flex flex-col gap-3">
        <Skeleton className="h-6 w-40" />
        <div className="grid grid-cols-3 divide-x divide-border border-y border-border">
          {Array.from({ length: 3 }, (_, index) => (
            <div key={index} className="flex min-h-[5.5rem] flex-col items-center justify-center gap-2">
              <Skeleton className="h-7 w-8" />
              <Skeleton className="h-3 w-16" />
            </div>
          ))}
        </div>
      </div>
      <div className="flex flex-col divide-y divide-border border-y border-border">
        <Skeleton className="my-4 h-6 w-2/3" />
        <Skeleton className="my-4 h-6 w-3/4" />
      </div>
    </div>
  );
}

// Todayの「今日のRe:Quest」（components/re-quest-card.tsx）
export function ReQuestSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Skeleton className="h-6 w-36" />
        <Skeleton className="h-4 w-3/4" />
      </div>
      <div className="flex flex-col gap-2">
        {Array.from({ length: 3 }, (_, index) => (
          <Skeleton key={index} className="h-12 w-full rounded-xl" />
        ))}
      </div>
      <div className="flex flex-col gap-2.5 pt-1">
        <Skeleton className="h-4 w-1/2" />
        <div className="grid grid-cols-7 gap-1">
          {Array.from({ length: 7 }, (_, index) => (
            <div key={index} className="flex justify-center">
              <Skeleton className="h-9 w-9 rounded-full" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// Re:Story（app/(main)/protected/story/page.tsx。月の切り替え・まとめ・タイムライン）
export function ReStorySkeleton() {
  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-center justify-between">
        <Skeleton className="h-11 w-11 rounded-full" />
        <div className="flex flex-col items-center gap-1.5">
          <Skeleton className="h-3 w-10" />
          <Skeleton className="h-8 w-14" />
        </div>
        <Skeleton className="h-11 w-11 rounded-full" />
      </div>
      <div className="flex flex-col gap-5 rounded-3xl bg-gradient-to-b from-blush/20 to-secondary/40 px-5 pb-5 pt-6">
        <div className="flex items-end gap-4">
          <Skeleton className="h-12 w-16 bg-card/70" />
          <Skeleton className="h-10 flex-1 bg-card/70" />
        </div>
        <div className="flex flex-col gap-2">
          {Array.from({ length: 5 }, (_, index) => (
            <Skeleton key={index} className="h-3 w-full bg-card/70" />
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-4">
        <Skeleton className="h-5 w-32" />
        {Array.from({ length: 3 }, (_, index) => (
          <div key={index} className="grid grid-cols-[3rem_1fr] gap-3">
            <Skeleton className="mx-auto h-8 w-8" />
            <Skeleton className="h-16 w-full rounded-xl" />
          </div>
        ))}
      </div>
    </div>
  );
}

// Todayの「Re:Garden」（components/garden-card.tsx）
export function GardenSkeleton() {
  return (
    <div className="flex flex-col gap-4 rounded-3xl bg-gradient-to-b from-primary/5 to-primary/15 px-5 pb-5 pt-6">
      <div className="flex flex-col gap-1.5">
        <Skeleton className="h-6 w-28" />
        <Skeleton className="h-3 w-3/4" />
      </div>
      <div className="flex flex-col items-center gap-2">
        <Skeleton className="h-40 w-40 rounded-full bg-card/70" />
        <Skeleton className="h-7 w-32 bg-card/70" />
      </div>
      <Skeleton className="h-16 w-full rounded-2xl bg-card/70" />
      <div className="grid grid-cols-6 gap-1">
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index} className="flex flex-col items-center gap-1.5">
            <Skeleton className="h-3 w-3 rounded-full bg-card/70" />
            <Skeleton className="h-3 w-6 bg-card/70" />
          </div>
        ))}
      </div>
      <div className="hidden grid-cols-5 gap-1 sm:grid">
        {Array.from({ length: 5 }, (_, index) => (
          <Skeleton key={index} className="h-12 rounded-xl bg-card/70" />
        ))}
      </div>
      <Skeleton className="h-11 w-full rounded-xl bg-card/70" />
    </div>
  );
}

// Todayの「今週のRe:Closet」（components/weekly-progress-card.tsx）
export function WeeklyProgressSkeleton() {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between">
        <Skeleton className="h-6 w-36" />
        <Skeleton className="h-3 w-14" />
      </div>
      <div className="grid grid-cols-2 divide-x divide-border border-y border-border py-4">
        <div className="flex flex-col gap-2 pr-4">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-8 w-24" />
        </div>
        <div className="flex flex-col gap-2 pl-4">
          <Skeleton className="h-3 w-14" />
          <Skeleton className="h-8 w-16" />
        </div>
      </div>
      <Skeleton className="h-2 w-full rounded-full" />
      <Skeleton className="h-4 w-3/4" />
      <div className="grid grid-cols-2 gap-2">
        <Skeleton className="h-10" />
        <Skeleton className="h-10" />
      </div>
    </div>
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
