"use client";

import { likeClothingItem, unlikeClothingItem } from "@/app/(main)/discover/actions";
import { cn } from "@/lib/utils";
import { Heart } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";

// 画像の上に重ねるハートの見た目（一覧カード・詳細の画像右上で共通）。
// 画像の色に埋もれないよう、半透明の背景と影をつける。タップ領域は44px。
const HEART_BUTTON_CLASS =
  "flex h-11 w-11 items-center justify-center rounded-full bg-background/85 shadow-md backdrop-blur transition-colors hover:bg-background disabled:opacity-70";

type LikeButtonProps = {
  itemId: string;
  initialLiked: boolean;
};

/**
 * Re:Closet Loopの「気になる」切り替えボタン（ログインユーザーの他人の公開服用）。
 * ♡で保存、♥で解除。押した瞬間に表示を切り替え、Server Actionが失敗したら元に戻す。
 * 通信中は押せない。保存の可否はServer Action・RLS側でも検証する。
 */
export function LikeButton({ itemId, initialLiked }: LikeButtonProps) {
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

  return (
    <div className="relative">
      <button
        type="button"
        aria-pressed={liked}
        aria-label="気になる"
        title={liked ? "気になるを解除" : "気になるに保存"}
        disabled={isPending}
        onClick={handleClick}
        className={HEART_BUTTON_CLASS}
      >
        <Heart
          className={cn("h-5 w-5", liked && "text-rose-500")}
          fill={liked ? "currentColor" : "none"}
          aria-hidden="true"
        />
      </button>
      {error && (
        <p
          role="alert"
          className="absolute right-0 top-12 z-10 w-max max-w-[10rem] rounded-md border bg-background px-2 py-1 text-xs text-red-500 shadow-sm"
        >
          {error}
        </p>
      )}
    </div>
  );
}

/** 未ログイン時のハート。押すとログインへ進み、ログイン後に元のページへ戻る */
export function LoginToLikeLink({ href }: { href: string }) {
  return (
    <Link
      href={href}
      aria-label="ログインして気になるに保存"
      title="ログインして気になるに保存"
      className={HEART_BUTTON_CLASS}
    >
      <Heart className="h-5 w-5" aria-hidden="true" />
    </Link>
  );
}
