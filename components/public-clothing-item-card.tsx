import { getCategoryLabel } from "@/lib/clothing-options";
import Image from "next/image";

// 一般公開ページ用のカード。本人用のClothingItemCardとは分け、
// 公開してよい情報（list_public_clothing_itemsの戻り値）だけを受け取る。
type PublicClothingItemCardProps = {
  title: string;
  brand: string | null;
  category: string;
  seasons: string[];
  ownerDisplayName: string;
  imageUrl: string | null;
};

export function PublicClothingItemCard({
  title,
  brand,
  category,
  ownerDisplayName,
  imageUrl,
}: PublicClothingItemCardProps) {
  return (
    // 枠のないカードで写真を主役にする（Closetのカードと同じ縦長4:5・生成りの背景）。
    // Loopではリンク（group）の中に置き、hoverで写真を少しだけ寄せて押せることを示す。
    // 季節は詳細ページで確認できるため、カードには出さない
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
        <span className="absolute bottom-2 left-2 rounded-full bg-card/90 px-2 py-0.5 text-[11px] font-medium leading-4 backdrop-blur-sm">
          {getCategoryLabel(category)}
        </span>
      </div>
      <div className="flex min-w-0 flex-col gap-0.5 px-0.5">
        <p className="line-clamp-2 break-words text-sm font-medium leading-snug">
          {title}
        </p>
        {brand && (
          <p className="truncate text-xs text-muted-foreground">{brand}</p>
        )}
        <p className="truncate text-[11px] text-muted-foreground">
          {ownerDisplayName}
        </p>
      </div>
    </div>
  );
}
