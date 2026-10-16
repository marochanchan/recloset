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
import { ClothingImageSection } from "@/components/clothing-image-section";
import {
  rememberDraftSavedNotice,
} from "@/components/draft-saved-notice";
import { EntryModeSelector } from "@/components/entry-mode-selector";
import { FavoriteToggle } from "@/components/favorite-toggle";
import { ImageAutofillStatus } from "@/components/image-autofill-status";
import {
  DEFAULT_LEAVE_DESCRIPTION,
  LeaveConfirmDialog,
} from "@/components/leave-confirm-dialog";
import { PhotoBatchRegisterForm } from "@/components/photo-batch-register-form";
import { SeasonSelector } from "@/components/season-selector";
import { useImageAutofill } from "@/components/use-image-autofill";
import {
  useClothingDraft,
  type ClothingDraftToResume,
} from "@/components/use-clothing-draft";
import type { DraftFields } from "@/lib/clothing-drafts";
import {
  PHOTO_ENTRY_PENDING_NOTE,
  resolveEntryLeaveGuards,
} from "@/lib/photo-batch-state";
import {
  MAX_IMAGE_COUNT,
  useClothingImages,
  type ExistingClothingImage,
  type ExistingImageItem,
  type NewImageItem,
} from "@/components/use-clothing-images";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getCategoryClassifiedPatch } from "@/lib/clothing-classify";
import {
  CATEGORY_OPTIONS,
  COLOR_OPTIONS,
  getSubcategoryOptions,
  isColorValue,
  isSubcategoryForCategory,
  normalizeSeasons,
  toLegacySeason,
  type SeasonValue,
} from "@/lib/clothing-options";
import {
  MARKETPLACE_SERVICES,
  MARKETPLACES,
  validateMarketplaceUrl,
  type MarketplaceService,
} from "@/lib/marketplace-urls";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

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
  /** 一部の画像が登録できず、下書きを残した */
  draftKept?: boolean;
  /** 服は登録できたが、下書きの削除に失敗した */
  draftCleanupFailed?: boolean;
};

// 既存の呼び出し側（編集画面など）向けに、画像の型をここからも参照できるようにする
export type { ExistingClothingImage };

export type ClothingItemFormInitialValues = {
  title: string;
  brand: string | null;
  category: string;
  /** 種類（migration 013）。nullは未設定 */
  subcategory: string | null;
  /** メインカラー（migration 013）。nullは未設定 */
  mainColor: string | null;
  /** 着られる季節（migration 012）。空配列は未設定 */
  seasons: string[];
  purchaseDate: string | null;
  purchasePrice: number | null;
  favorite: boolean;
  marketplaceUrls: Record<MarketplaceService, string | null>;
};


/** 新規登録の入力方法（通常登録・写真だけ登録） */
export type ClothingEntryMode = "normal" | "photo";

type ClothingItemFormProps = {
  mode?: "create" | "edit";
  /** mode === "edit" のとき必須 */
  itemId?: string;
  initialValues?: ClothingItemFormInitialValues;
  initialImages?: ExistingClothingImage[];
  /** 新規登録で再開する下書き（サーバーで本人の下書きと確認済み） */
  draft?: ClothingDraftToResume | null;
  /**
   * 新規登録ページで「写真だけ登録」を選んだとき（親が写真からまとめて登録する画面を
   * 表示する）。指定したときだけ、入力方法の切り替えを表示する
   */
  onEntryModeChange?: (mode: ClothingEntryMode) => void;
  /** 離脱の確認をこのフォームで行うか（新規登録ページで隠れているときはfalse） */
  leaveGuardEnabled?: boolean;
  /** 写真だけ登録の画面に、まだ登録していない写真がある（離脱の確認に含める） */
  otherEntryPending?: boolean;
  /** 保存していない変更の有無が変わったとき（新規登録ページで離脱の確認をまとめるため） */
  onDirtyChange?: (isDirty: boolean) => void;
} & React.ComponentPropsWithoutRef<"div">;

export function ClothingItemForm({
  className,
  mode = "create",
  itemId,
  initialValues,
  initialImages = [],
  draft = null,
  onEntryModeChange,
  leaveGuardEnabled = true,
  otherEntryPending = false,
  onDirtyChange,
  ...props
}: ClothingItemFormProps) {
  const isEdit = mode === "edit";
  // 写真だけ登録（写真からまとめて登録）は別の画面（photo-batch-register-form.tsx）。
  // 切り替えを出すのは、新しく登録するとき（下書きの再開・編集を除く）だけ
  const canChooseEntryMode = !isEdit && !draft && onEntryModeChange !== undefined;

  // フォームの初期値。下書きから再開する場合は下書きの値、編集では保存済みの値。
  // 未保存の変更があるかどうかの基準にもなる
  const [initialFields] = useState<DraftFields>(() =>
    draft
      ? draft.fields
      : {
          title: initialValues?.title ?? "",
          brand: initialValues?.brand ?? "",
          category: initialValues?.category ?? "",
          // 種類はカテゴリーに属する値だけを持つ
          subcategory: isSubcategoryForCategory(
            initialValues?.category ?? "",
            initialValues?.subcategory,
          )
            ? (initialValues?.subcategory ?? "")
            : "",
          mainColor: isColorValue(initialValues?.mainColor)
            ? (initialValues?.mainColor ?? "")
            : "",
          seasons: normalizeSeasons(initialValues?.seasons),
          purchaseDate: initialValues?.purchaseDate ?? "",
          purchasePrice:
            initialValues?.purchasePrice != null
              ? String(initialValues.purchasePrice)
              : "",
          favorite: initialValues?.favorite ?? false,
          marketplaceUrls: {
            mercari: initialValues?.marketplaceUrls.mercari ?? "",
            rakuma: initialValues?.marketplaceUrls.rakuma ?? "",
            yahooFurima: initialValues?.marketplaceUrls.yahooFurima ?? "",
          },
        },
  );

  const [title, setTitle] = useState(initialFields.title);
  const [brand, setBrand] = useState(initialFields.brand);
  const [category, setCategory] = useState(initialFields.category);
  // 種類・メインカラー（空文字は未設定）
  const [subcategory, setSubcategory] = useState(initialFields.subcategory);
  const [mainColor, setMainColor] = useState(initialFields.mainColor);
  // カテゴリーを変えたとき（手動・AIどちらでも）、合わなくなった種類は空に戻す
  const changeCategory = (value: string) => {
    setCategory(value);
    setSubcategory((current) =>
      isSubcategoryForCategory(value, current) ? current : "",
    );
  };
  const [seasons, setSeasons] = useState<SeasonValue[]>(initialFields.seasons);
  const [purchaseDate, setPurchaseDate] = useState(initialFields.purchaseDate);
  const [purchasePrice, setPurchasePrice] = useState(
    initialFields.purchasePrice,
  );
  const [favorite, setFavorite] = useState(initialFields.favorite);
  const [marketplaceUrls, setMarketplaceUrls] = useState<
    Record<MarketplaceService, string>
  >(initialFields.marketplaceUrls);
  const [marketplaceUrlErrors, setMarketplaceUrlErrors] = useState<
    Partial<Record<MarketplaceService, string>>
  >({});
  // 保存済みURLがある場合・エラーがある場合は折りたたみを開いておく
  const [isMarketplaceOpen, setIsMarketplaceOpen] = useState(() =>
    MARKETPLACE_SERVICES.some((service) => initialFields.marketplaceUrls[service]),
  );

  // 購入日・購入価格は「詳しく入力」に折りたたむ（値があれば開いておく）
  const [isDetailsOpen, setIsDetailsOpen] = useState(
    () => Boolean(initialFields.purchaseDate) || initialFields.purchasePrice !== "",
  );

  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  // 二重登録の防止。isLoadingは次の描画まで反映されないため、refを併用する
  // （登録に成功して画面を移動するときは、離れるまで戻さない）
  const submittingRef = useRef(false);
  const [savedItem, setSavedItem] = useState<SavedItemState | null>(null);
  const router = useRouter();

  // 登録後に移動した画面から「戻る」でこのフォームが再表示されたとき
  // （cacheComponents の <Activity> で状態が残る）、登録ボタンを押せるよう戻す
  useLayoutEffect(() => {
    return () => {
      submittingRef.current = false;
      setIsLoading(false);
    };
  }, []);
  const imageState = useClothingImages({
    initialImages,
    onError: setError,
  });
  const {
    images,
    activeImages,
    isPreparingImages,
    resetImages,
    addDraftImages,
    setDraftPaths,
  } = imageState;

  // 新規登録では、代表画像（先頭）からタイトル・カテゴリーを自動入力する
  const representativeImage = activeImages[0];
  const autofill = useImageAutofill({
    enabled: !isEdit,
    target:
      representativeImage?.kind === "new" &&
      representativeImage.processed &&
      !representativeImage.isProcessing
        ? {
            key: representativeImage.key,
            rotation: representativeImage.rotation,
            sourceFile: representativeImage.sourceFile,
            fromDraft: representativeImage.fromDraft,
          }
        : null,
    fields: {
      title: { value: title, set: setTitle },
      category: { value: category, set: changeCategory },
      subcategory: { value: subcategory, set: setSubcategory },
      mainColor: { value: mainColor, set: setMainColor },
      seasons: { value: seasons, set: setSeasons },
    },
  });

  // 下書き（新規登録のみ）。保存は手動、再開時は写真と入力値を戻す
  const currentFields: DraftFields = {
    title,
    brand,
    category,
    subcategory,
    mainColor,
    seasons,
    purchaseDate,
    purchasePrice,
    favorite,
    marketplaceUrls,
  };
  const clothingDraft = useClothingDraft({
    enabled: !isEdit,
    initialDraft: draft,
    initialFields,
    fields: currentFields,
    images: activeImages.filter(
      (img): img is NewImageItem => img.kind === "new",
    ),
    addDraftImages,
    setDraftPaths,
    leaveGuardEnabled,
    externalPending: otherEntryPending,
  });
  const isDirty = clothingDraft.isDirty;
  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);
  const isDraftBlocking =
    clothingDraft.isLoadingDraft || clothingDraft.draftLoadFailed;

  // 新規登録で使う服のID。フォームを開いている間は同じIDを使い、
  // 再試行しても同じ服が2着できないようにする（登録が完了したら作り直す）
  const pendingItemIdRef = useRef<string | null>(null);

  const resetForm = () => {
    pendingItemIdRef.current = null;
    setTitle("");
    setBrand("");
    setCategory("");
    setSubcategory("");
    setMainColor("");
    setSeasons([]);
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
    if (submittingRef.current) return;
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
    submittingRef.current = true;
    setIsLoading(true);
    // 登録に成功して画面を移動するときは、移動するまでボタンを押せないままにする
    let isLeaving = false;

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

      const targetItemId =
        isEdit && itemId
          ? itemId
          : (pendingItemIdRef.current ??= crypto.randomUUID());

      const payload = {
        title,
        brand: brand || null,
        category,
        // 種類はカテゴリーに属する値、メインカラーは選択肢にある値だけを保存する
        subcategory: isSubcategoryForCategory(category, subcategory)
          ? subcategory
          : null,
        main_color: isColorValue(mainColor) ? mainColor : null,
        seasons,
        // 旧season列（互換用）: 4季節→'all'、1季節→その値、それ以外→null
        season: toLegacySeason(seasons),
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
          .update({
            ...payload,
            // カテゴリを変えたときだけ、分類した日時を記録する（migration 018。
            // クイック仕分けで未分類として扱わないため）
            ...getCategoryClassifiedPatch(
              initialValues?.category ?? "",
              category,
              new Date(),
            ),
          })
          .eq("id", targetItemId);
        if (updateError) throw updateError;
      } else {
        const { error: insertError } = await supabase
          .from("clothing_items")
          .insert({ id: targetItemId, user_id: user.id, ...payload });
        if (insertError?.code === "23505") {
          // 前回の登録で行の作成だけ成功していた（応答が届かなかった）場合。
          // 新しく作らず、同じ服の内容を更新して続ける（RLSで本人の行だけ）
          const { data: existing, error: retryError } = await supabase
            .from("clothing_items")
            .update(payload)
            .eq("id", targetItemId)
            .select("id")
            .maybeSingle();
          if (retryError) throw retryError;
          if (!existing) throw insertError;
        } else if (insertError) {
          throw insertError;
        }
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
      const uploadedPaths: string[] = [];
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
          uploadedPaths.push(path);
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

      // 新規登録で画像が1枚でも登録できなかった場合は、登録を取り消して
      // フォームに戻す（入力値・写真・下書きはそのまま。同じIDで再試行できる）。
      // clothing_images の行は clothing_items の削除に連動して消える。
      if (!isEdit && failedImages > 0) {
        if (uploadedPaths.length > 0) {
          const { error: removeError } = await supabase.storage
            .from("clothing-images")
            .remove(uploadedPaths);
          if (removeError) {
            console.error("registration rollback: image cleanup failed:", removeError);
          }
        }
        const { data: rolledBack, error: rollbackError } = await supabase
          .from("clothing_items")
          .delete()
          .eq("id", targetItemId)
          .select("id")
          .maybeSingle();
        if (!rollbackError && rolledBack) {
          throw new Error(
            "写真の登録に失敗したため、登録を取り消しました。入力内容と写真はそのままです。もう一度お試しください",
          );
        }
        // 取り消しにも失敗した場合だけ、従来どおり「一部の画像が未登録」として扱う
        console.error("registration rollback failed:", rollbackError);
      }

      // ここで服の登録・更新は完了している。以降は離脱確認を出さない
      clothingDraft.allowLeave();

      if (failedImages > 0) {
        // 一部の画像が登録できなかった場合、下書き（写真の控え）は残しておく
        setSavedItem({
          id: targetItemId,
          totalImages: newImages.length,
          failedImages,
          draftKept: clothingDraft.draftId !== null,
        });
      } else if (isEdit) {
        isLeaving = true;
        router.push(`/protected/items/${targetItemId}`);
      } else if (!(await clothingDraft.completeDraft())) {
        // 服は登録済み。下書きの削除だけ失敗したことを伝える（二重登録を防ぐため、
        // フォームには戻さない）
        setSavedItem({
          id: targetItemId,
          totalImages: newImages.length,
          failedImages: 0,
          draftCleanupFailed: true,
        });
      } else {
        isLeaving = true;
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
      if (!isLeaving) {
        submittingRef.current = false;
        setIsLoading(false);
      }
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
            {savedItem.failedImages > 0 && (
              <p className="text-sm text-amber-800 dark:text-amber-300">
                {isEdit ? "服の情報は保存されましたが、" : "服は登録されましたが、"}
                {savedItem.totalImages}枚中
                {savedItem.failedImages}枚の画像登録に失敗しました
                {savedItem.draftKept &&
                  "。写真は下書きに残してあります（下書き一覧から確認できます）"}
              </p>
            )}
            {savedItem.draftCleanupFailed && (
              <p className="text-sm text-amber-800 dark:text-amber-300">
                服は登録されました。下書きの削除に失敗したため、下書き一覧から削除してください
                （もう一度登録する必要はありません）
              </p>
            )}
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
              {(savedItem.draftKept || savedItem.draftCleanupFailed) && (
                <Link
                  href="/protected/items/drafts"
                  className="underline underline-offset-4"
                >
                  下書き一覧へ
                </Link>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <LeaveConfirmDialog
        {...clothingDraft.leaveConfirm}
        description={
          // 写真だけ登録の画面（隠れている）に未登録の写真があれば、1回の確認で一緒に伝える
          otherEntryPending
            ? isDirty
              ? `${DEFAULT_LEAVE_DESCRIPTION}${PHOTO_ENTRY_PENDING_NOTE}`
              : PHOTO_ENTRY_PENDING_NOTE
            : undefined
        }
      />
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
          {canChooseEntryMode && (
            <EntryModeSelector
              isPhotoOnly={false}
              onChange={(photoOnly) => {
                if (photoOnly) onEntryModeChange?.("photo");
              }}
              disabled={isLoading || clothingDraft.isSavingDraft}
            />
          )}
          <p className="mb-4 text-xs text-muted-foreground">* 必須項目</p>
          <form
            onSubmit={handleSubmit}
            onInvalidCapture={(e) => {
              // 閉じた折りたたみの中の入力が不正な場合は、開いて見えるようにする
              const details = (e.target as HTMLElement).closest("details");
              if (details && !details.open) details.open = true;
            }}
          >
            <div className="flex flex-col gap-6">
              <ClothingImageSection
                imageState={imageState}
                description={
                  isEdit
                    ? "写真を追加・並べ替え・削除できます"
                    : "写真からタイトルとカテゴリーを自動入力できます。写真なしでも登録できます"
                }
                autofillStatus={
                  isEdit ? undefined : (
                    <ImageAutofillStatus
                      status={autofill.status}
                      canAnalyze={autofill.canAnalyze}
                      onAnalyze={autofill.analyzeNow}
                    />
                  )
                }
              />

              <>
                  <div className="grid gap-2">
                    <Label htmlFor="title" className="flex items-center gap-2">
                      タイトル *
                      {autofill.isAiValue("title") && <AiBadge />}
                    </Label>
                    <Input
                      id="title"
                      type="text"
                      required
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                    />
                  </div>

                  <div className="grid gap-2">
                    <Label htmlFor="category" className="flex items-center gap-2">
                      カテゴリー *
                      {autofill.isAiValue("category") && <AiBadge />}
                    </Label>
                    <select
                      id="category"
                      required
                      className={selectClassName}
                      value={category}
                      onChange={(e) => changeCategory(e.target.value)}
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

                  {/* 種類はカテゴリーごとに選択肢が変わる（シューズ・バッグ・その他にはない） */}
                  {getSubcategoryOptions(category).length > 0 && (
                    <div className="grid gap-2">
                      <Label htmlFor="subcategory" className="flex items-center gap-2">
                        種類
                        {autofill.isAiValue("subcategory") && <AiBadge />}
                      </Label>
                      <select
                        id="subcategory"
                        className={selectClassName}
                        value={subcategory}
                        onChange={(e) => setSubcategory(e.target.value)}
                      >
                        <option value="">未選択</option>
                        {getSubcategoryOptions(category).map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                      {autofill.needsCheck("subcategory") && <NeedsCheckNote />}
                    </div>
                  )}

                  <div className="grid gap-2">
                    <Label htmlFor="main-color" className="flex items-center gap-2">
                      メインカラー
                      {autofill.isAiValue("mainColor") && <AiBadge />}
                    </Label>
                    <select
                      id="main-color"
                      className={selectClassName}
                      value={mainColor}
                      onChange={(e) => setMainColor(e.target.value)}
                    >
                      <option value="">未選択</option>
                      {COLOR_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    {autofill.needsCheck("mainColor") && <NeedsCheckNote />}
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
                    <Label id="seasons-label" className="flex items-center gap-2">
                      シーズン
                      {autofill.isAiValue("seasons") && <AiBadge />}
                    </Label>
                    <SeasonSelector
                      value={seasons}
                      onChange={setSeasons}
                      labelId="seasons-label"
                      describedBy="seasons-description"
                    />
                    <p id="seasons-description" className="text-sm text-muted-foreground">
                      {autofill.needsCheck("seasons")
                        ? "季節は写真だけでは判断しにくいため、確認してください"
                        : "着られる季節をすべて選べます（未選択でも登録できます）"}
                    </p>
                  </div>

                  <FavoriteToggle checked={favorite} onCheckedChange={setFavorite} />

                  <details
                    className="rounded-md border px-3 py-2"
                    open={isDetailsOpen}
                    onToggle={(e) => setIsDetailsOpen(e.currentTarget.open)}
                  >
                    <summary className="cursor-pointer text-sm font-medium">
                      詳しく入力（任意）
                    </summary>
                    <div className="flex flex-col gap-6 pb-1 pt-3">
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
                    </div>
                  </details>

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
                              <p className="text-sm text-destructive">{fieldError}</p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </details>
                </>

              {error && <p className="text-sm text-destructive">{error}</p>}
              {clothingDraft.isLoadingDraft && (
                <p className="text-sm text-muted-foreground">
                  下書きの写真を読み込んでいます…
                </p>
              )}
              {clothingDraft.draftLoadFailed && (
                <p className="text-sm text-destructive">
                  下書きの写真を読み込めませんでした。写真を失わないよう、保存・登録を止めています。ページを再読み込みしてください
                </p>
              )}
              <Button
                type="submit"
                className="w-full"
                disabled={
                  isLoading ||
                  isPreparingImages ||
                  clothingDraft.isSavingDraft ||
                  isDraftBlocking
                }
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
              {!isEdit && (
                <div className="flex flex-col gap-1">
                  <Button
                    type="button"
                    variant="outline"
                    className="w-full"
                    onClick={async () => {
                      // 保存に成功したときだけCloset一覧へ移動する
                      // （失敗したら画面に残り、入力値と写真はそのまま）
                      if (await clothingDraft.saveDraft()) {
                        rememberDraftSavedNotice();
                        router.push("/protected/items");
                      }
                    }}
                    disabled={
                      isLoading ||
                      isPreparingImages ||
                      clothingDraft.isSavingDraft ||
                      isDraftBlocking
                    }
                  >
                    {clothingDraft.isSavingDraft
                      ? "下書きを保存中..."
                      : "下書きとして保存"}
                  </Button>
                  {clothingDraft.draftMessage && (
                    <p
                      className={
                        clothingDraft.draftMessage.tone === "error"
                          ? "text-sm text-destructive"
                          : "text-sm text-muted-foreground"
                      }
                    >
                      {clothingDraft.draftMessage.text}
                    </p>
                  )}
                </div>
              )}
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

// 写真からAIが入力した値の目印（ユーザーが修正すると消える）
function AiBadge() {
  return (
    <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
      写真から入力
    </span>
  );
}

// AIの確信度が低い項目に添える注意書き
function NeedsCheckNote() {
  return (
    <p className="text-sm text-muted-foreground">
      写真だけでは判断しにくいため、確認してください
    </p>
  );
}

/**
 * 新規登録ページ用。cacheComponents が有効な App Router は、離れたページを
 * <Activity> で隠したまま残し、次に同じパスを開いたときに入力中の状態ごと
 * 再表示する（検索パラメータは区別しない）。リンク・router.push で開いたときは
 * 毎回新しいフォームにし、ブラウザの「戻る・進む」では状態を戻す。
 * 下書きを再開するときは下書きIDも key に含める。
 */
export function NewClothingItemForm({
  draft = null,
  entryMode = "normal",
}: {
  draft?: ClothingDraftToResume | null;
  entryMode?: ClothingEntryMode;
}) {
  const { bfcacheId } = useRouter();
  if (draft) {
    return (
      <ClothingItemForm key={`${bfcacheId}:${draft.id}:normal`} draft={draft} />
    );
  }
  return (
    <NewClothingItemEntry key={`${bfcacheId}:new:${entryMode}`} entryMode={entryMode} />
  );
}

// 通常登録と、写真からまとめて登録する画面（photo-batch-register-form.tsx）を切り替える。
// 切り替えても入力中の内容・選んだ写真が消えないよう、どちらも表示を隠すだけにする
// （写真からまとめて登録する画面は、はじめて選んだときに作る）。
// 離脱の確認は表示中の画面だけが行い、もう一方の未保存の内容も1回の確認で伝える
// （隠れた画面の確認ダイアログは見えないため、二重に・見えない確認を出さない）
function NewClothingItemEntry({ entryMode }: { entryMode: ClothingEntryMode }) {
  const [mode, setMode] = useState<ClothingEntryMode>(entryMode);
  const [isPhotoMounted, setIsPhotoMounted] = useState(entryMode === "photo");
  const [normalDirty, setNormalDirty] = useState(false);
  const [photoPending, setPhotoPending] = useState(false);
  const changeMode = (next: ClothingEntryMode) => {
    if (next === "photo") setIsPhotoMounted(true);
    setMode(next);
  };
  const guards = resolveEntryLeaveGuards({ mode, normalDirty, photoPending });
  return (
    <>
      <div hidden={mode !== "normal"}>
        <ClothingItemForm
          onEntryModeChange={changeMode}
          leaveGuardEnabled={guards.normal}
          otherEntryPending={photoPending}
          onDirtyChange={setNormalDirty}
        />
      </div>
      {isPhotoMounted && (
        <div hidden={mode !== "photo"}>
          <PhotoBatchRegisterForm
            onSwitchToNormal={() => changeMode("normal")}
            leaveGuardEnabled={guards.photo}
            otherEntryDirty={normalDirty}
            onPendingChange={setPhotoPending}
          />
        </div>
      )}
    </>
  );
}
