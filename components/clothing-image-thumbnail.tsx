"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { GripVertical, Loader2, RotateCw } from "lucide-react";
import Image from "next/image";

// 服登録フォームの画像1枚分（サムネイル・拡大・回転・削除・並び替えハンドル）。
// 状態は持たず、操作はすべて親（ClothingItemForm）へ通知する。

type ClothingImageThumbnailProps = {
  /** 表示する画像のURL。新しい画像の処理中はnull */
  src: string | null;
  /** 新しく選んだ画像（回転できる）か、保存済みの画像か */
  kind: "new" | "existing";
  isProcessing: boolean;
  isPendingDelete: boolean;
  isConfirmingDelete: boolean;
  canDrag: boolean;
  isDragging: boolean;
  isDragOverTarget: boolean;
  itemRef: (el: HTMLDivElement | null) => void;
  onOpen: () => void;
  onRotate: () => void;
  onDelete: () => void;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
  onRestore: () => void;
  onDragPointerDown: (e: React.PointerEvent<HTMLDivElement>) => void;
  onDragPointerMove: (e: React.PointerEvent<HTMLDivElement>) => void;
  onDragPointerUp: () => void;
};

export function ClothingImageThumbnail({
  src,
  kind,
  isProcessing,
  isPendingDelete,
  isConfirmingDelete,
  canDrag,
  isDragging,
  isDragOverTarget,
  itemRef,
  onOpen,
  onRotate,
  onDelete,
  onConfirmDelete,
  onCancelDelete,
  onRestore,
  onDragPointerDown,
  onDragPointerMove,
  onDragPointerUp,
}: ClothingImageThumbnailProps) {
  return (
    <div
      ref={itemRef}
      className={cn(
        "flex w-28 flex-col items-center gap-1",
        isDragging && "opacity-50",
      )}
    >
      <div
        className={cn(
          "relative h-28 w-28 overflow-hidden rounded-xl border border-border/70 bg-photo",
          isPendingDelete && "opacity-40",
          isDragOverTarget && "ring-2 ring-primary",
        )}
      >
        {src ? (
          // サムネイル全体を押すと拡大表示する
          <button
            type="button"
            onClick={onOpen}
            aria-label="画像を拡大して見る"
            className="absolute inset-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          >
            <Image
              src={src}
              alt=""
              fill
              sizes="112px"
              className="object-contain"
              style={{ objectFit: "contain" }}
              unoptimized={kind === "new"}
            />
          </button>
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <Loader2
              className="h-5 w-5 animate-spin text-muted-foreground"
              aria-label="画像を準備中"
            />
          </div>
        )}

        {canDrag && !isConfirmingDelete && (
          <div
            role="button"
            aria-label="ドラッグして並び替え"
            title="ドラッグして並び替え"
            className="absolute right-1 top-1 flex h-6 w-6 touch-none cursor-grab items-center justify-center rounded-md bg-card/90 text-muted-foreground active:cursor-grabbing"
            onPointerDown={onDragPointerDown}
            onPointerMove={onDragPointerMove}
            onPointerUp={onDragPointerUp}
            onPointerCancel={onDragPointerUp}
          >
            <GripVertical className="h-4 w-4" />
          </div>
        )}

        {/* 回転の処理中は、前の向きの画像の上に小さく示す */}
        {src && isProcessing && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/60">
            <Loader2
              className="h-5 w-5 animate-spin text-muted-foreground"
              aria-label="画像を準備中"
            />
          </div>
        )}
      </div>

      {isPendingDelete ? (
        <>
          <p className="text-xs text-destructive">削除予定</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 w-full px-1 text-xs"
            onClick={onRestore}
          >
            元に戻す
          </Button>
        </>
      ) : isConfirmingDelete ? (
        <div className="flex w-full flex-col gap-1 rounded-lg border border-destructive/40 bg-destructive/5 p-1.5">
          <p className="text-center text-[11px] text-destructive">
            この画像を削除しますか？
          </p>
          <Button
            type="button"
            variant="destructive"
            size="sm"
            className="h-7 w-full px-1 text-[11px]"
            onClick={onConfirmDelete}
          >
            画像を削除する
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 w-full px-1 text-[11px]"
            onClick={onCancelDelete}
          >
            キャンセル
          </Button>
        </div>
      ) : (
        <div className="flex w-full gap-1">
          {kind === "new" && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 w-9 shrink-0 px-0"
              onClick={onRotate}
              disabled={isProcessing}
              aria-label="右に90°回転"
              title="右に90°回転"
            >
              <RotateCw aria-hidden="true" />
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 flex-1 px-1 text-xs"
            onClick={onDelete}
          >
            削除
          </Button>
        </div>
      )}
    </div>
  );
}
