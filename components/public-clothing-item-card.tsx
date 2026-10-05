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
    <Card className="overflow-hidden">
      <div className="relative aspect-square bg-muted">
        {imageUrl ? (
          <Image
            src={imageUrl}
            alt={title}
            fill
            sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw"
            className="object-contain"
            style={{ objectFit: "contain" }}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-sm text-muted-foreground">
            画像なし
          </div>
        )}
      </div>
      <CardHeader>
        <CardTitle className="text-lg">{title}</CardTitle>
        {brand && <p className="text-sm text-muted-foreground">{brand}</p>}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary">{getCategoryLabel(category)}</Badge>
          {season && (
            <Badge variant="secondary">{getSeasonLabel(season)}</Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground">{ownerDisplayName}</p>
      </CardContent>
    </Card>
  );
}
