import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  getCategoryLabel,
  getStatusLabel,
  PHOTO_ONLY_DISPLAY_LABEL,
  PHOTO_ONLY_TITLE,
} from "@/lib/clothing-options";
import { getWearRecencyLabel } from "@/lib/wear-logs";
import { Heart } from "lucide-react";
import Image from "next/image";

type ClothingItemCardProps = {
  title: string;
  brand: string | null;
  category: string;
  seasons: string[];
  favorite: boolean;
  status: string;
  lastWornAt: string | null;
  isPublic: boolean;
  imageUrl: string | null;
};

export function ClothingItemCard({
  title,
  brand,
  category,
  favorite,
  status,
  lastWornAt,
  isPublic,
  imageUrl,
}: ClothingItemCardProps) {
  // 写真だけ登録した服は、仮タイトルを並べず「未仕分け」と短く出す（表示のみ）。
  // カテゴリも仮の「その他」のため出さない
  const isPhotoOnly = title === PHOTO_ONLY_TITLE;

  return (
    // 画像の縦横比に関係なく、同じ正方形の枠にobject-containで収める
    // （服全体を見せるためトリミングしない）。画像なしでも同じ枠を保つ。
    // スマホは2列のため、文字は最小限にして写真を主役にする。
    // 季節は絞り込みで確認できるためカードには出さない。
    // 一覧ではリンク（group）の中に置き、hoverで影を強めて押せることを示す
    <Card className="flex h-full flex-col overflow-hidden transition-shadow group-hover:shadow-md">
      <div className="relative aspect-square w-full shrink-0 overflow-hidden bg-muted">
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
        {/* 公開中・お気に入りは、画像の隅に小さく示す（文字の情報量を増やさない） */}
        {isPublic && (
          <Badge
            variant="outline"
            className="absolute left-2 top-2 bg-background/90 px-2"
          >
            公開中
          </Badge>
        )}
        {favorite && (
          <span className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-background/90 shadow-sm">
            <Heart className="h-4 w-4 fill-current" aria-hidden="true" />
            <span className="sr-only">お気に入り</span>
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-2 p-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          {isPhotoOnly ? (
            <p className="text-sm text-muted-foreground">
              {PHOTO_ONLY_DISPLAY_LABEL}
            </p>
          ) : (
            <p className="line-clamp-2 break-words text-sm font-semibold leading-snug">
              {title}
            </p>
          )}
          {brand && (
            <p className="truncate text-xs text-muted-foreground">{brand}</p>
          )}
        </div>
        <div className="mt-auto flex flex-col gap-1.5">
          <div className="flex flex-wrap gap-1">
            {!isPhotoOnly && (
              <Badge variant="secondary" className="px-2">
                {getCategoryLabel(category)}
              </Badge>
            )}
            <Badge variant="outline" className="px-2">
              {getStatusLabel(status)}
            </Badge>
          </div>
          {/* 見直しの判断材料になる「最後に着た時期」は1行で残す */}
          <p className="truncate text-[11px] text-muted-foreground">
            {getWearRecencyLabel(lastWornAt)}
          </p>
        </div>
      </div>
    </Card>
  );
}
