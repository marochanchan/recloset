import {
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

// 画像の上に小さく重ねるラベル（公開中・状態）
const PHOTO_LABEL_CLASS =
  "rounded-full bg-card/90 px-2 py-0.5 text-[11px] font-medium leading-4 text-foreground backdrop-blur-sm";

export function ClothingItemCard({
  title,
  brand,
  favorite,
  status,
  lastWornAt,
  isPublic,
  imageUrl,
}: ClothingItemCardProps) {
  // 写真だけ登録した服は、仮タイトルを並べず「未仕分け」と短く出す（表示のみ）
  const isPhotoOnly = title === PHOTO_ONLY_TITLE;
  // ふだんの「クローゼット」以外（手放し候補・出品中・売却済み）だけ状態を示す
  const showStatus = status !== "closet";

  return (
    // 枠のないカードにして写真を主役にする。画像は縦長（4:5）の生成りの枠に
    // object-containで収める（服全体を見せるためトリミングしない）。画像なしでも同じ枠を保つ。
    // カテゴリ・季節は絞り込みで確認できるためカードには出さない。
    // 一覧ではリンク（group）の中に置き、hoverで写真を少しだけ寄せて押せることを示す
    <div className="flex h-full flex-col gap-2">
      <div className="relative aspect-[4/5] w-full shrink-0 overflow-hidden rounded-xl bg-photo">
        {imageUrl ? (
          <Image
            src={imageUrl}
            alt={title}
            fill
            sizes="(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw"
            className="object-contain motion-safe:transition-transform motion-safe:duration-300 group-hover:scale-[1.03]"
            style={{ objectFit: "contain" }}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-sm text-muted-foreground">
            画像なし
          </div>
        )}
        {/* 公開中・状態・お気に入りは、画像の隅に小さく示す（文字の情報量を増やさない） */}
        {(isPublic || showStatus) && (
          <div className="absolute left-2 top-2 flex flex-col items-start gap-1">
            {showStatus && (
              <span className={PHOTO_LABEL_CLASS}>{getStatusLabel(status)}</span>
            )}
            {isPublic && <span className={PHOTO_LABEL_CLASS}>公開中</span>}
          </div>
        )}
        {favorite && (
          <span className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-card/90 text-blush-foreground backdrop-blur-sm">
            <Heart className="h-4 w-4 fill-current" aria-hidden="true" />
            <span className="sr-only">お気に入り</span>
          </span>
        )}
      </div>
      <div className="flex min-w-0 flex-col gap-0.5 px-0.5">
        {isPhotoOnly ? (
          <p className="text-sm text-muted-foreground">
            {PHOTO_ONLY_DISPLAY_LABEL}
          </p>
        ) : (
          <p className="line-clamp-2 break-words text-sm font-medium leading-snug">
            {title}
          </p>
        )}
        {brand && (
          <p className="truncate text-xs text-muted-foreground">{brand}</p>
        )}
        {/* 見直しの判断材料になる「最後に着た時期」は控えめに1行で残す */}
        <p className="truncate text-[11px] text-muted-foreground">
          {getWearRecencyLabel(lastWornAt)}
        </p>
      </div>
    </div>
  );
}
