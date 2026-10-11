"use client";

import { cn } from "@/lib/utils";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { ClothingImageThumbnail } from "@/components/clothing-image-thumbnail";
import { ImageLightbox } from "@/components/image-lightbox";
import {
  MAX_IMAGE_COUNT,
  useClothingImages,
  type ExistingClothingImage,
  type ExistingImageItem,
  type NewImageItem,
} from "@/components/use-clothing-images";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CATEGORY_OPTIONS, SEASON_OPTIONS } from "@/lib/clothing-options";
import {
  MARKETPLACE_SERVICES,
  MARKETPLACES,
  validateMarketplaceUrl,
  type MarketplaceService,
} from "@/lib/marketplace-urls";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

const selectClassName = cn(
  "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
);

// 保存する（縮小・再エンコード後の）画像の上限。Storageバケットの上限と同じ
const MAX_IMAGE_SIZE = 10 * 1024 * 1024; // 10MB

// (clothing_item_id, sort_order) のUNIQUE制約と衝突しないよう、
// 既存画像の並び替え中だけ一時的に使う退避用オフセット。
// 1アイテムあたり最大5枚なので、1000という余裕を持った値で十分安全。
const SORT_ORDER_PARK_OFFSET = 1000;

type SavedItemState = {
  id: string;
  totalImages: number;
  failedImages: number;
};

// 既存の呼び出し側（編集画面など）向けに、画像の型をここからも参照できるようにする
export type { ExistingClothingImage };

export type ClothingItemFormInitialValues = {
  title: string;
  brand: string | null;
  category: string;
  season: string | null;
  purchaseDate: string | null;
  purchasePrice: number | null;
  favorite: boolean;
  marketplaceUrls: Record<MarketplaceService, string | null>;
};


type ClothingItemFormProps = {
  mode?: "create" | "edit";
  /** mode === "edit" のとき必須 */
  itemId?: string;
  initialValues?: ClothingItemFormInitialValues;
  initialImages?: ExistingClothingImage[];
} & React.ComponentPropsWithoutRef<"div">;

export function ClothingItemForm({
  className,
  mode = "create",
  itemId,
  initialValues,
  initialImages = [],
  ...props
}: ClothingItemFormProps) {
  const isEdit = mode === "edit";

  const [title, setTitle] = useState(initialValues?.title ?? "");
  const [brand, setBrand] = useState(initialValues?.brand ?? "");
  const [category, setCategory] = useState(initialValues?.category ?? "");
  const [season, setSeason] = useState(initialValues?.season ?? "");
  const [purchaseDate, setPurchaseDate] = useState(
    initialValues?.purchaseDate ?? "",
  );
  const [purchasePrice, setPurchasePrice] = useState(
    initialValues?.purchasePrice != null
      ? String(initialValues.purchasePrice)
      : "",
  );
  const [favorite, setFavorite] = useState(initialValues?.favorite ?? false);
  const [marketplaceUrls, setMarketplaceUrls] = useState<
    Record<MarketplaceService, string>
  >(() => ({
    mercari: initialValues?.marketplaceUrls.mercari ?? "",
    rakuma: initialValues?.marketplaceUrls.rakuma ?? "",
    yahooFurima: initialValues?.marketplaceUrls.yahooFurima ?? "",
  }));
  const [marketplaceUrlErrors, setMarketplaceUrlErrors] = useState<
    Partial<Record<MarketplaceService, string>>
  >({});
  // 保存済みURLがある場合・エラーがある場合は折りたたみを開いておく
  const [isMarketplaceOpen, setIsMarketplaceOpen] = useState(() =>
    MARKETPLACE_SERVICES.some(
      (service) => initialValues?.marketplaceUrls[service],
    ),
  );

  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [savedItem, setSavedItem] = useState<SavedItemState | null>(null);
  const router = useRouter();
  const {
    images,
    activeImages,
    isPreparingImages,
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
    resetImages,
  } = useClothingImages({ initialImages, onError: setError });


  const resetForm = () => {
    setTitle("");
    setBrand("");
    setCategory("");
    setSeason("");
    setPurchaseDate("");
    setPurchasePrice("");
    setFavorite(false);
    setMarketplaceUrls({ mercari: "", rakuma: "", yahooFurima: "" });
    setMarketplaceUrlErrors({});
    resetImages();
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // 出品URLは保存前に検証し、1つでも不正なら保存しない
    // （DB側にも同じ内容のCHECK制約がある）
    const validatedUrls = {} as Record<MarketplaceService, string | null>;
    const urlErrors: Partial<Record<MarketplaceService, string>> = {};
    for (const service of MARKETPLACE_SERVICES) {
      const result = validateMarketplaceUrl(service, marketplaceUrls[service]);
      if (result.ok) {
        validatedUrls[service] = result.value;
      } else {
        urlErrors[service] = result.error;
      }
    }
    setMarketplaceUrlErrors(urlErrors);
    if (Object.keys(urlErrors).length > 0) {
      setIsMarketplaceOpen(true);
      setError("出品先URLの入力内容を確認してください");
      return;
    }

    const newImages = images.filter(
      (img): img is NewImageItem => img.kind === "new",
    );
    const activeExistingCount = images.filter(
      (img) => img.kind === "existing" && !img.pendingDelete,
    ).length;

    if (activeExistingCount + newImages.length > MAX_IMAGE_COUNT) {
      setError(`画像は合計${MAX_IMAGE_COUNT}枚までです`);
      return;
    }
    // 新しい画像は、縮小・再エンコードが終わったものだけを保存する
    if (newImages.some((img) => img.isProcessing || !img.processed)) {
      setError("画像を準備しています。少し待ってから保存してください");
      return;
    }
    if (newImages.some((img) => (img.processed?.size ?? 0) > MAX_IMAGE_SIZE)) {
      setError("10MBを超える画像が含まれています");
      return;
    }

    const supabase = createClient();
    setIsLoading(true);

    // 保存時点での「削除予定を除いた、確定した並び順」を固定しておく。
    const orderedActiveImages = images.filter(
      (img) => !(img.kind === "existing" && img.pendingDelete),
    );

    try {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();
      if (userError) throw userError;
      if (!user) throw new Error("ログイン情報が確認できませんでした");

      const targetItemId = isEdit && itemId ? itemId : crypto.randomUUID();

      const payload = {
        title,
        brand: brand || null,
        category,
        season: season || null,
        purchase_date: purchaseDate || null,
        purchase_price: purchasePrice === "" ? null : Number(purchasePrice),
        favorite,
        mercari_url: validatedUrls.mercari,
        rakuma_url: validatedUrls.rakuma,
        yahoo_furima_url: validatedUrls.yahooFurima,
      };

      // 1. 服本体の情報を更新する。ここが失敗した場合は、画像の並び替え・
      //    追加・削除処理には一切進まない。
      if (isEdit) {
        const { error: updateError } = await supabase
          .from("clothing_items")
          .update(payload)
          .eq("id", targetItemId);
        if (updateError) throw updateError;
      } else {
        const { error: insertError } = await supabase
          .from("clothing_items")
          .insert({ id: targetItemId, user_id: user.id, ...payload });
        if (insertError) throw insertError;
      }

      if (isEdit) {
        const existingItemsInForm = images.filter(
          (img): img is ExistingImageItem => img.kind === "existing",
        );

        if (existingItemsInForm.length > 0) {
          try {
            // 2-a. 既存画像（削除予定分も含む）すべてのsort_orderを、
            //      一時的に重複しない大きな値へ退避する。
            //      これを行わずに新しい並び順を直接UPDATEすると、
            //      途中でUNIQUE制約(clothing_item_id, sort_order)に
            //      衝突する可能性があるため。
            for (let i = 0; i < existingItemsInForm.length; i++) {
              const { error: parkError } = await supabase
                .from("clothing_images")
                .update({ sort_order: SORT_ORDER_PARK_OFFSET + i })
                .eq("id", existingItemsInForm[i].id);
              if (parkError) throw parkError;
            }

            // 2-b. 削除予定ではない既存画像だけを、確定した並び順の
            //      位置（0, 1, 2...）に更新する。この時点で0..N-1の
            //      範囲は退避済みで空いているため、衝突しない。
            for (let i = 0; i < orderedActiveImages.length; i++) {
              const image = orderedActiveImages[i];
              if (image.kind !== "existing") continue;
              const { error: reorderError } = await supabase
                .from("clothing_images")
                .update({ sort_order: i })
                .eq("id", image.id);
              if (reorderError) throw reorderError;
            }
          } catch (reorderError: unknown) {
            console.error("clothing image reorder failed:", reorderError);
            throw new Error("画像の並び替えに失敗しました");
          }
        }
      }

      // 3. 新規画像をアップロードし、確定した並び順の位置にinsertする。
      //    既存の生存画像は2-bで既に自分の最終位置へ移動済みのため、
      //    新規画像の位置と衝突しない。
      let failedImages = 0;
      for (let i = 0; i < orderedActiveImages.length; i++) {
        const image = orderedActiveImages[i];
        if (image.kind !== "new" || !image.processed) continue;
        try {
          // 保存するのは元のファイルではなく、向き補正・回転・縮小した
          // JPEG（EXIF・位置情報等を含まない）
          const path = `${user.id}/${targetItemId}/${crypto.randomUUID()}.jpg`;

          const { error: uploadError } = await supabase.storage
            .from("clothing-images")
            .upload(path, image.processed, { contentType: "image/jpeg" });
          if (uploadError) throw uploadError;

          const { error: imageInsertError } = await supabase
            .from("clothing_images")
            .insert({
              clothing_item_id: targetItemId,
              image_path: path,
              sort_order: i,
            });
          if (imageInsertError) {
            const { error: removeError } = await supabase.storage
              .from("clothing-images")
              .remove([path]);
            if (removeError) {
              console.error("clothing image cleanup failed:", removeError);
            }
            throw imageInsertError;
          }
        } catch (imageError: unknown) {
          console.error("clothing image registration failed:", imageError);
          failedImages++;
        }
      }

      // 4. 削除予定にしていた既存画像は、ここで初めて確定削除する
      //    （服本体の更新・並び替え・新規画像の追加が成功した後）。
      const imagesToDelete = images.filter(
        (img): img is ExistingImageItem =>
          img.kind === "existing" && img.pendingDelete,
      );
      for (const image of imagesToDelete) {
        try {
          const { error: deleteRowError } = await supabase
            .from("clothing_images")
            .delete()
            .eq("id", image.id);
          if (deleteRowError) throw deleteRowError;

          const { error: removeError } = await supabase.storage
            .from("clothing-images")
            .remove([image.imagePath]);
          if (removeError) {
            console.error(
              "clothing image storage remove failed (on save):",
              removeError,
            );
          }
        } catch (deleteError: unknown) {
          // 服本体の更新・並び替え・新規画像の追加は既に成功しているため、
          // 削除予定画像の確定削除に失敗してもここでは致命的エラーとしない
          // （ログに残し、必要なら再度編集画面から削除し直せる）。
          console.error(
            "clothing image delete failed (on save):",
            deleteError,
          );
        }
      }

      if (failedImages > 0) {
        setSavedItem({
          id: targetItemId,
          totalImages: newImages.length,
          failedImages,
        });
      } else if (isEdit) {
        router.push(`/protected/items/${targetItemId}`);
      } else {
        resetForm();
        router.push("/protected/items");
      }
    } catch (error: unknown) {
      console.error(
        isEdit ? "clothing item update failed:" : "clothing item registration failed:",
        error,
      );
      const message =
        typeof error === "object" && error !== null && "message" in error
          ? String((error as { message?: unknown }).message)
          : isEdit
            ? "服の更新に失敗しました"
            : "服の登録に失敗しました";
      setError(message);
    } finally {
      setIsLoading(false);
    }
  };

  if (savedItem) {
    return (
      <div className={cn("flex flex-col gap-6", className)} {...props}>
        <Card>
          <CardHeader>
            <CardTitle className="text-2xl">
              {isEdit ? "服を編集" : "服を登録"}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <p className="text-sm text-yellow-600">
              {isEdit ? "服の情報は保存されましたが、" : "服は登録されましたが、"}
              {savedItem.totalImages}枚中
              {savedItem.failedImages}枚の画像登録に失敗しました
            </p>
            <div className="flex flex-col gap-2 text-sm">
              <Link
                href={`/protected/items/${savedItem.id}`}
                className="underline underline-offset-4"
              >
                {isEdit ? "服の詳細に戻る" : "登録済みの服を見る"}
              </Link>
              <Link
                href="/protected/items"
                className="underline underline-offset-4"
              >
                クローゼット一覧へ戻る
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">
            {isEdit ? "服を編集" : "服を登録"}
          </CardTitle>
          {!isEdit && (
            <CardDescription>
              クローゼットに新しいアイテムを追加します
            </CardDescription>
          )}
        </CardHeader>
        <CardContent>
          <p className="mb-4 text-xs text-muted-foreground">* 必須項目</p>
          <form onSubmit={handleSubmit}>
            <div className="flex flex-col gap-6">
              <div className="grid gap-2">
                <Label htmlFor="title">タイトル *</Label>
                <Input
                  id="title"
                  type="text"
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="brand">ブランド</Label>
                <Input
                  id="brand"
                  type="text"
                  value={brand}
                  onChange={(e) => setBrand(e.target.value)}
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="category">カテゴリー *</Label>
                <select
                  id="category"
                  required
                  className={selectClassName}
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                >
                  <option value="" disabled>
                    選択してください
                  </option>
                  {CATEGORY_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="season">シーズン</Label>
                <select
                  id="season"
                  className={selectClassName}
                  value={season}
                  onChange={(e) => setSeason(e.target.value)}
                >
                  <option value="">未選択</option>
                  {SEASON_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="purchase-date">購入日（任意）</Label>
                <Input
                  id="purchase-date"
                  type="date"
                  value={purchaseDate}
                  onChange={(e) => setPurchaseDate(e.target.value)}
                />
                <p className="text-sm text-muted-foreground">
                  わからない場合は空欄でOKです
                </p>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="purchase-price">購入価格（税込・任意）</Label>
                <Input
                  id="purchase-price"
                  type="number"
                  min="0"
                  step="0.01"
                  value={purchasePrice}
                  onChange={(e) => setPurchasePrice(e.target.value)}
                />
                <p className="text-sm text-muted-foreground">
                  税込価格。わからない場合は空欄でOKです
                </p>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="images">画像（任意・最大{MAX_IMAGE_COUNT}枚）</Label>

                {images.length > 0 && (
                  <>
                    <p className="text-sm text-muted-foreground">
                      最大{MAX_IMAGE_COUNT}枚・先頭がメイン画像になります
                    </p>
                    <div className="flex flex-wrap gap-3">
                      {images.map((image) => {
                        const isPendingDelete =
                          image.kind === "existing" && image.pendingDelete;

                        return (
                          <ClothingImageThumbnail
                            key={image.key}
                            src={
                              image.kind === "existing"
                                ? image.url
                                : image.previewUrl
                            }
                            kind={image.kind}
                            isProcessing={
                              image.kind === "new" && image.isProcessing
                            }
                            isPendingDelete={isPendingDelete}
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
                              if (image.kind === "new") {
                                handleRotateNewImage(image);
                              }
                            }}
                            onDelete={() =>
                              image.kind === "existing"
                                ? setConfirmingKey(image.key)
                                : handleRemoveNewImage(image)
                            }
                            onConfirmDelete={() => {
                              if (image.kind === "existing") {
                                handleMarkImageForDeletion(image);
                              }
                            }}
                            onCancelDelete={handleCancelDeleteImage}
                            onRestore={() => {
                              if (image.kind === "existing") {
                                handleRestoreImage(image);
                              }
                            }}
                            onDragPointerDown={(e) =>
                              handleDragHandlePointerDown(e, image.key)
                            }
                            onDragPointerMove={handleDragHandlePointerMove}
                            onDragPointerUp={handleDragHandlePointerUp}
                          />
                        );
                      })}
                    </div>
                  </>
                )}

                <input
                  id="images"
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
                  onChange={handleImagesChange}
                  className={selectClassName}
                />
                <p className="text-sm text-muted-foreground">
                  残り
                  {Math.max(
                    MAX_IMAGE_COUNT - activeImages.length,
                    0,
                  )}
                  枚まで追加できます。画像を押すと拡大・回転できます
                </p>
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
                  isProcessing={
                    lightboxImage?.kind === "new" && lightboxImage.isProcessing
                  }
                />
              </div>

              <div className="flex items-center gap-2">
                <Checkbox
                  id="favorite"
                  checked={favorite}
                  onCheckedChange={(checked) => setFavorite(checked === true)}
                />
                <Label htmlFor="favorite">お気に入りに登録する</Label>
              </div>

              <details
                className="rounded-md border px-3 py-2"
                open={isMarketplaceOpen}
                onToggle={(e) => setIsMarketplaceOpen(e.currentTarget.open)}
              >
                <summary className="cursor-pointer text-sm font-medium">
                  出品先URL（任意）
                </summary>
                <div className="flex flex-col gap-4 pb-1 pt-3">
                  <p className="text-sm text-muted-foreground">
                    出品しているサービスのURLだけ入力してください。
                  </p>
                  {MARKETPLACE_SERVICES.map((service) => {
                    const inputId = `marketplace-${service}`;
                    const fieldError = marketplaceUrlErrors[service];
                    return (
                      <div key={service} className="grid gap-2">
                        <Label htmlFor={inputId}>
                          {MARKETPLACES[service].label}
                        </Label>
                        <Input
                          id={inputId}
                          type="text"
                          inputMode="url"
                          autoComplete="off"
                          placeholder={MARKETPLACES[service].example}
                          value={marketplaceUrls[service]}
                          aria-invalid={fieldError ? true : undefined}
                          onChange={(e) =>
                            setMarketplaceUrls((prev) => ({
                              ...prev,
                              [service]: e.target.value,
                            }))
                          }
                        />
                        {fieldError && (
                          <p className="text-sm text-red-500">{fieldError}</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </details>

              {error && <p className="text-sm text-red-500">{error}</p>}
              <Button
                type="submit"
                className="w-full"
                disabled={isLoading || isPreparingImages}
              >
                {isPreparingImages && !isLoading
                  ? "画像を準備中..."
                  : isLoading
                  ? isEdit
                    ? "保存中..."
                    : "登録中..."
                  : isEdit
                    ? "保存する"
                    : "登録する"}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
