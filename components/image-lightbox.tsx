"use client";

import { Button } from "@/components/ui/button";
import { RotateCw, X } from "lucide-react";
import Image from "next/image";
import { useEffect, useRef } from "react";

type ImageLightboxProps = {
  /** 表示する画像のURL。nullのときは閉じる */
  src: string | null;
  alt: string;
  onClose: () => void;
  /** 渡したときだけ「回転」ボタンを表示する（新しく選んだ画像のみ） */
  onRotate?: () => void;
  /** 回転後の画像を作り直している間はtrue */
  isProcessing?: boolean;
};

// 画像の拡大表示。ネイティブの<dialog>（showModal）を使うため、
// Escで閉じる・背景の操作無効化・フォーカスの閉じ込めと復帰はブラウザが行う。
export function ImageLightbox({
  src,
  alt,
  onClose,
  onRotate,
  isProcessing = false,
}: ImageLightboxProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (src && !dialog.open) {
      dialog.showModal();
    } else if (!src && dialog.open) {
      dialog.close();
    }
  }, [src]);

  return (
    <dialog
      ref={dialogRef}
      aria-label="画像の拡大表示"
      // Escや✕で閉じたときに親の状態も閉じる
      onClose={onClose}
      // 背景（::backdrop）のクリックで閉じる
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      className="m-auto h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-3xl rounded-xl border bg-background p-0 text-foreground shadow-lg backdrop:bg-black/70"
    >
      {src && (
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
            {onRotate ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onRotate}
                disabled={isProcessing}
              >
                <RotateCw aria-hidden="true" />
                {isProcessing ? "回転中..." : "回転"}
              </Button>
            ) : (
              <span />
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="閉じる"
              className="flex h-10 w-10 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
          <div className="relative flex-1 bg-photo">
            <Image
              src={src}
              alt={alt}
              fill
              sizes="(min-width: 768px) 768px, 100vw"
              className="object-contain"
              style={{ objectFit: "contain" }}
              unoptimized
            />
          </div>
        </div>
      )}
    </dialog>
  );
}
