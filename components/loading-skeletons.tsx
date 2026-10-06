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
