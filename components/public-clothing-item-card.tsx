import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getCategoryLabel, getSeasonLabel } from "@/lib/clothing-options";
import Image from "next/image";

// 一般公開ページ用のカード。本人用のClothingItemCardとは分け、
// 公開してよい情報（list_public_clothing_itemsの戻り値）だけを受け取る。
type PublicClothingItemCardProps = {
  title: string;
  brand: string | null;
  category: string;
  season: string | null;
  ownerDisplayName: string;
  imageUrl: string | null;
};

export function PublicClothingItemCard({
  title,
  brand,
  category,
  season,
  ownerDisplayName,
  imageUrl,
}: PublicClothingItemCardProps) {
  return (
    <Card className="flex h-full flex-col overflow-hidden">
      <div className="relative aspect-square bg-muted">
        {imageUrl ? (
          <Image
            src={imageUrl}
            alt={title}
            fill
            sizes="(min-width: 1024px) 33vw, 50vw"
            className="object-contain"
            style={{ objectFit: "contain" }}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-sm text-muted-foreground">
            画像なし
          </div>
        )}
      </div>
      {/* スマホは2列表示のため余白・文字を詰め、季節バッジは省略する */}
      <CardHeader className="space-y-1 p-3 sm:p-6 sm:pb-3">
        <CardTitle className="line-clamp-2 text-sm leading-snug sm:text-lg sm:leading-snug">
          {title}
        </CardTitle>
        {brand && (
          <p className="truncate text-xs text-muted-foreground sm:text-sm">
            {brand}
          </p>
        )}
      </CardHeader>
      <CardContent className="mt-auto flex flex-col gap-2 p-3 pt-0 sm:gap-3 sm:p-6 sm:pt-0">
        <div className="flex flex-wrap gap-1.5 sm:gap-2">
          <Badge variant="secondary">{getCategoryLabel(category)}</Badge>
          {season && (
            <Badge variant="secondary" className="hidden sm:inline-flex">
              {getSeasonLabel(season)}
            </Badge>
          )}
        </div>
        <p className="truncate text-xs text-muted-foreground">
          {ownerDisplayName}
        </p>
      </CardContent>
    </Card>
  );
}
