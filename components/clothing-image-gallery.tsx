"use client";

import { DoodleHanger } from "@/components/doodle-icons";
import { cn } from "@/lib/utils";
import { ChevronLeft, ChevronRight } from "lucide-react";
import Image from "next/image";
import { useRef, useState } from "react";

type ClothingImageGalleryProps = {
  images: string[];
  alt: string;
};

const SWIPE_THRESHOLD_X = 50; // これ以上横に動いたらスワイプとみなす
const SWIPE_MAX_Y = 30; // 縦方向がこれを超えたら縦スクロールとみなし無視する

export function ClothingImageGallery({
  images,
  alt,
}: ClothingImageGalleryProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const pointerStart = useRef<{ x: number; y: number } | null>(null);
  const hasMultiple = images.length > 1;

  const goToPrevious = () => {
    setCurrentIndex((i) => (i - 1 + images.length) % images.length);
  };

  const goToNext = () => {
    setCurrentIndex((i) => (i + 1) % images.length);
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!hasMultiple) return;
    pointerStart.current = { x: e.clientX, y: e.clientY };
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!hasMultiple || !pointerStart.current) return;
    const deltaX = e.clientX - pointerStart.current.x;
    const deltaY = e.clientY - pointerStart.current.y;
    pointerStart.current = null;

    if (Math.abs(deltaY) > SWIPE_MAX_Y) return;
    if (Math.abs(deltaX) < SWIPE_THRESHOLD_X) return;

    if (deltaX > 0) {
      goToPrevious();
    } else {
      goToNext();
    }
  };

  const handlePointerLeave = () => {
    pointerStart.current = null;
  };

  const handlePointerCancel = () => {
    pointerStart.current = null;
  };

  if (images.length === 0) {
    return (
      <div className="relative flex aspect-[4/5] w-full flex-col items-center justify-center gap-3 rounded-2xl bg-photo">
        <DoodleHanger size={56} className="text-primary/50" />
        <p className="text-sm text-muted-foreground">画像なし</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div
        className="relative aspect-[4/5] w-full touch-pan-y overflow-hidden rounded-2xl bg-photo"
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerLeave}
        onPointerCancel={handlePointerCancel}
      >
        <Image
          src={images[currentIndex]}
          alt={alt}
          fill
          sizes="(min-width: 640px) 448px, 100vw"
          className="object-contain"
          style={{ objectFit: "contain" }}
          priority
        />

        {hasMultiple && (
          <>
            <button
              type="button"
              onClick={goToPrevious}
              aria-label="前の画像"
              className="absolute left-2 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-card/85 shadow-sm backdrop-blur-sm outline-none hover:bg-card focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <button
              type="button"
              onClick={goToNext}
              aria-label="次の画像"
              className="absolute right-2 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-card/85 shadow-sm backdrop-blur-sm outline-none hover:bg-card focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ChevronRight className="h-5 w-5" />
            </button>
            {/* 何枚目かを右下に小さく示す */}
            <span className="absolute bottom-2 right-2 rounded-full bg-card/85 px-2 py-0.5 text-[11px] tabular-nums backdrop-blur-sm" aria-hidden="true">
              {currentIndex + 1} / {images.length}
            </span>
          </>
        )}
      </div>

      {hasMultiple && (
        <div className="-m-1 flex gap-2 overflow-x-auto p-1">
          {images.map((url, index) => (
            <button
              key={url}
              type="button"
              onClick={() => setCurrentIndex(index)}
              aria-label={`${index + 1}枚目の画像を表示`}
              aria-current={index === currentIndex}
              className={cn(
                "relative h-16 w-16 shrink-0 overflow-hidden rounded-xl border-2 bg-photo outline-none focus-visible:ring-2 focus-visible:ring-ring",
                index === currentIndex
                  ? "border-primary"
                  : "border-transparent",
              )}
            >
              <Image
                src={url}
                alt=""
                fill
                sizes="64px"
                className="object-contain"
                style={{ objectFit: "contain" }}
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
