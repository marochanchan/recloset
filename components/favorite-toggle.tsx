"use client";

import { cn } from "@/lib/utils";
import { Heart } from "lucide-react";

// 「お気に入りの服」の目印（clothing_items.favorite）。
// 押すたびにON/OFFが切り替わるトグルボタン。状態は aria-pressed で読み上げる。
// 意味（アプリ上の目印で、今の気持ちとしての「好き」とは別）は従来どおり。
export function FavoriteToggle({
  checked,
  onCheckedChange,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <div className="grid gap-1">
      <button
        type="button"
        aria-pressed={checked}
        aria-describedby="favorite-description"
        onClick={() => onCheckedChange(!checked)}
        className={cn(
          "flex h-10 w-fit items-center gap-2 rounded-full border px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          checked
            ? "border-blush bg-blush/20 text-blush-foreground"
            : "border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground",
        )}
      >
        <Heart
          className="h-4 w-4"
          fill={checked ? "currentColor" : "none"}
          aria-hidden="true"
        />
        お気に入りの服
      </button>
      <p id="favorite-description" className="text-sm text-muted-foreground">
        特に気に入っている服に付ける目印です。
      </p>
    </div>
  );
}
