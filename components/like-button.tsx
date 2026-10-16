"use client";

import { likeClothingItem, unlikeClothingItem } from "@/app/(main)/discover/actions";
import { cn } from "@/lib/utils";
import { Heart, X } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";

// 画像の上に重ねるハートの見た目（一覧カード・詳細の画像右上で共通）。
// 画像の色に埋もれないよう、半透明の背景と影をつける。タップ領域は44px。
const HEART_BUTTON_CLASS =
  "flex h-11 w-11 items-center justify-center rounded-full bg-card/90 shadow-sm backdrop-blur-sm outline-none transition-colors hover:bg-card focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-70";

type LikeButtonProps = {
  itemId: string;
  initialLiked: boolean;
  /** 保存に成功したとき、保存先（気になる服）への案内を出す（詳細ページだけで使う） */
  showSavedNotice?: boolean;
};

/**
 * Re:Closet Loopの「気になる」切り替えボタン（ログインユーザーの他人の公開服用）。
 * ♡で保存、♥で解除。押した瞬間に表示を切り替え、Server Actionが失敗したら元に戻す。
 * 通信中は押せない。保存の可否はServer Action・RLS側でも検証する。
 * showSavedNotice のときは、保存がサーバーで成功した後だけ保存先への案内を出す
 * （押した直後・失敗時・解除時には出さない）。
 */
export function LikeButton({
  itemId,
  initialLiked,
  showSavedNotice = false,
}: LikeButtonProps) {
  const [liked, setLiked] = useState(initialLiked);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [savedNoticeVisible, setSavedNoticeVisible] = useState(false);

  const handleClick = () => {
    if (isPending) return;
    const nextLiked = !liked;
    setLiked(nextLiked);
    setError(null);
    setSavedNoticeVisible(false);
    startTransition(async () => {
      const result = nextLiked
        ? await likeClothingItem(itemId)
        : await unlikeClothingItem(itemId);
      if (result.error) {
        setLiked(!nextLiked);
        setError(result.error);
        return;
      }
      if (nextLiked && showSavedNotice) {
        setSavedNoticeVisible(true);
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
          className={cn("h-5 w-5", liked && "text-blush-foreground")}
          fill={liked ? "currentColor" : "none"}
          aria-hidden="true"
        />
      </button>
      {savedNoticeVisible && !error && (
        <div
          role="status"
          className="absolute right-0 top-12 z-10 flex w-max max-w-[15rem] items-start gap-1 rounded-xl border border-border/70 bg-card py-1.5 pl-3 pr-1 text-xs shadow-md"
        >
          <p className="flex flex-col gap-1 py-0.5">
            <span>気になる服に保存しました</span>
            <Link
              href="/protected/likes"
              className="font-medium underline underline-offset-4 hover:text-foreground"
            >
              気になる服を見る →
            </Link>
          </p>
          <button
            type="button"
            aria-label="案内を閉じる"
            onClick={() => setSavedNoticeVisible(false)}
            className="-my-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      )}
      {error && (
        <p
          role="alert"
          className="absolute right-0 top-12 z-10 w-max max-w-[10rem] rounded-xl border border-border/70 bg-card px-2.5 py-1.5 text-xs text-destructive shadow-sm"
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
