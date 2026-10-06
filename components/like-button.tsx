"use client";

import { likeClothingItem, unlikeClothingItem } from "@/app/discover/actions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ArrowRight, Heart } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";

type LikeButtonProps = {
  itemId: string;
  initialLiked: boolean;
  /** compact: Loop一覧カードの画像右上（アイコンのみ） / full: Loop詳細（文言付き） */
  variant?: "compact" | "full";
};

/**
 * Re:Closet Loopの「気になる」切り替えボタン（ログインユーザーの他人の公開服用）。
 * 押した瞬間に表示を切り替え、Server Actionが失敗したら元に戻す。
 * 通信中は押せない。保存の可否はServer Action・RLS側でも検証する。
 */
export function LikeButton({
  itemId,
  initialLiked,
  variant = "full",
}: LikeButtonProps) {
  const [liked, setLiked] = useState(initialLiked);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleClick = () => {
    if (isPending) return;
    const nextLiked = !liked;
    setLiked(nextLiked);
    setError(null);
    startTransition(async () => {
      const result = nextLiked
        ? await likeClothingItem(itemId)
        : await unlikeClothingItem(itemId);
      if (result.error) {
        setLiked(!nextLiked);
        setError(result.error);
      }
    });
  };

  const icon = (
    <Heart
      className="h-4 w-4"
      fill={liked ? "currentColor" : "none"}
      aria-hidden="true"
    />
  );

  if (variant === "compact") {
    return (
      <div className="relative">
        <button
          type="button"
          aria-pressed={liked}
          aria-label="気になる"
          title={liked ? "気になるを解除" : "気になるに保存"}
          disabled={isPending}
          onClick={handleClick}
          className="flex h-10 w-10 items-center justify-center rounded-full border bg-background/90 shadow-sm transition-colors hover:bg-accent disabled:opacity-70"
        >
          {icon}
        </button>
        {error && (
          <p
            role="alert"
            className="absolute right-0 top-11 z-10 w-max max-w-[10rem] rounded-md border bg-background px-2 py-1 text-xs text-red-500 shadow-sm"
          >
            {error}
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-pressed={liked}
          disabled={isPending}
          onClick={handleClick}
          className={cn("h-10 gap-2", liked && "bg-accent")}
        >
          {icon}
          気になる
        </Button>
        {liked && (
          <Link
            href="/protected/likes"
            className="flex items-center gap-1 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            気になる服を見る
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        )}
      </div>
      {error && (
        <p role="alert" className="text-xs text-red-500">
          {error}
        </p>
      )}
    </div>
  );
}
