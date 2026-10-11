"use client";

import { ClothingImageThumbnail } from "@/components/clothing-image-thumbnail";
import { ImageLightbox } from "@/components/image-lightbox";
import {
  MAX_IMAGE_COUNT,
  type useClothingImages,
} from "@/components/use-clothing-images";
import { cn } from "@/lib/utils";
import { ImagePlus } from "lucide-react";

// 服登録フォームの一番上に置く写真欄（追加ボタン・サムネイル・拡大表示）。
// 画像の状態と操作は useClothingImages（フォーム側で保持）をそのまま使う。

type ClothingImagesState = ReturnType<typeof useClothingImages>;

export function ClothingImageSection({
  imageState,
  description,
  autofillStatus,
}: {
  imageState: ClothingImagesState;
  /** 写真欄の案内文（新規登録では自動入力の案内） */
  description: string;
  /** 写真欄のすぐ下に表示するAI自動入力の状態（新規登録のみ） */
  autofillStatus?: React.ReactNode;
}) {
  const {
    images,
    activeImages,
    fileInputRef,
    confirmingKey,
    setConfirmingKey,
    lightboxImage,
    setLightboxKey,
    draggingKey,
    dragOverKey,
    isDraggableImage,
    registerItemRef,
    handleImagesChange,
    handleRotateNewImage,
    handleRemoveNewImage,
    handleMarkImageForDeletion,
    handleRestoreImage,
    handleCancelDeleteImage,
    handleDragHandlePointerDown,
    handleDragHandlePointerMove,
    handleDragHandlePointerUp,
  } = imageState;

  const remaining = Math.max(MAX_IMAGE_COUNT - activeImages.length, 0);
  const isFull = remaining === 0;

  return (
    <section aria-labelledby="images-heading" className="grid gap-3">
      <div className="grid gap-1">
        <h2 id="images-heading" className="text-sm font-medium">
          写真（任意・最大{MAX_IMAGE_COUNT}枚）
        </h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>

      {/* ファイル選択欄は見えないようにし、ラベルを大きなボタンとして使う。
          inputはフォーカス可能なまま残すため、キーボードでも開ける */}
      <div>
        <input
          id="images"
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
          onChange={handleImagesChange}
          disabled={isFull}
          className="peer sr-only"
        />
        <label
          htmlFor="images"
          className={cn(
            "flex min-h-14 w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 py-3 text-sm font-medium transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-ring",
            isFull
              ? "cursor-not-allowed text-muted-foreground opacity-60"
              : "cursor-pointer hover:bg-accent",
          )}
        >
          <ImagePlus className="h-5 w-5" aria-hidden="true" />
          {isFull ? "写真は5枚まで追加済みです" : "写真を追加"}
        </label>
      </div>

      {images.length > 0 && (
        <div className="flex flex-wrap gap-3">
          {images.map((image) => (
            <ClothingImageThumbnail
              key={image.key}
              src={image.kind === "existing" ? image.url : image.previewUrl}
              kind={image.kind}
              isProcessing={image.kind === "new" && image.isProcessing}
              isPendingDelete={image.kind === "existing" && image.pendingDelete}
              isConfirmingDelete={confirmingKey === image.key}
              canDrag={isDraggableImage(image)}
              isDragging={draggingKey === image.key}
              isDragOverTarget={
                draggingKey !== null &&
                draggingKey !== image.key &&
                dragOverKey === image.key
              }
              itemRef={registerItemRef(image.key)}
              onOpen={() => setLightboxKey(image.key)}
              onRotate={() => {
                if (image.kind === "new") handleRotateNewImage(image);
              }}
              onDelete={() =>
                image.kind === "existing"
                  ? setConfirmingKey(image.key)
                  : handleRemoveNewImage(image)
              }
              onConfirmDelete={() => {
                if (image.kind === "existing") handleMarkImageForDeletion(image);
              }}
              onCancelDelete={handleCancelDeleteImage}
              onRestore={() => {
                if (image.kind === "existing") handleRestoreImage(image);
              }}
              onDragPointerDown={(e) => handleDragHandlePointerDown(e, image.key)}
              onDragPointerMove={handleDragHandlePointerMove}
              onDragPointerUp={handleDragHandlePointerUp}
            />
          ))}
        </div>
      )}

      {images.length > 0 && (
        <p className="text-xs text-muted-foreground">
          先頭がメイン画像です。画像を押すと拡大・回転できます（残り{remaining}
          枚）
        </p>
      )}

      {autofillStatus}

      <ImageLightbox
        src={
          lightboxImage === null
            ? null
            : lightboxImage.kind === "existing"
              ? lightboxImage.url
              : lightboxImage.previewUrl
        }
        alt="選択した画像"
        onClose={() => setLightboxKey(null)}
        onRotate={
          lightboxImage?.kind === "new"
            ? () => handleRotateNewImage(lightboxImage)
            : undefined
        }
        isProcessing={lightboxImage?.kind === "new" && lightboxImage.isProcessing}
      />
    </section>
  );
}
