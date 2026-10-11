"use client";

import {
  getNextRotation,
  ImageProcessingError,
  processImageForUpload,
  type ImageRotation,
} from "@/lib/image-processing";
import { useEffect, useRef, useState } from "react";

// 服登録フォームの画像（既存画像・新しく選んだ画像）の状態と操作。
// 選択・向き補正/回転/縮小・拡大表示・削除・並び替えを扱い、
// DB・Storageへの保存はフォーム側（handleSubmit）が行う。

export const MAX_IMAGE_COUNT = 5;

export type ExistingClothingImage = {
  id: string;
  imagePath: string;
  sortOrder: number;
  url: string;
};

// 既存画像・新規選択画像を1つの並び順として扱うための統合表現。
export type ExistingImageItem = {
  kind: "existing";
  key: string;
  id: string;
  imagePath: string;
  url: string;
  pendingDelete: boolean;
};

// 新しく選んだ画像。元のファイル（sourceFile）は変更せず、向き補正・回転・
// 縮小したJPEG（processed）を作り直して、プレビューと保存の両方に使う
// （画面で見た画像と保存される画像を一致させるため）。
export type NewImageItem = {
  kind: "new";
  key: string;
  sourceFile: File;
  rotation: ImageRotation;
  processed: Blob | null;
  previewUrl: string | null;
  isProcessing: boolean;
  /**
   * 今の processed が下書き（Storage）に保存済みならそのパス。
   * 回転などで processed を作り直したら null に戻す（次の下書き保存で再アップロードする）
   */
  draftPath: string | null;
  /** 下書きから読み込んだ画像か（再開時はAIの自動解析をしない） */
  fromDraft: boolean;
};

export type ImageItem = ExistingImageItem | NewImageItem;

export function useClothingImages({
  initialImages,
  onError,
}: {
  initialImages: ExistingClothingImage[];
  /** ユーザーに表示するエラー（nullで消す） */
  onError: (message: string | null) => void;
}) {
  // 既存画像＋新規選択画像を、画面に表示している順番そのままで保持する。
  // 「削除」は既存画像をpendingDelete:trueにするだけで、保存するまでは
  // DB・Storageへは一切アクセスしない。
  const [images, setImages] = useState<ImageItem[]>(() =>
    initialImages.map((img) => ({
      kind: "existing" as const,
      key: img.id,
      id: img.id,
      imagePath: img.imagePath,
      url: img.url,
      pendingDelete: false,
    })),
  );
  const [confirmingKey, setConfirmingKey] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // 新規画像のローカルプレビュー用object URL。削除時・アンマウント時に
  // 必ずrevokeし、不要なURLを残さない。
  const objectUrlsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    // objectUrlsRef.current は再代入されず、常に同じSetを変更し続けるため、
    // ここで捕まえた参照はアンマウント時点の最新の内容を指す。
    const urls = objectUrlsRef.current;
    return () => {
      urls.forEach((url) => URL.revokeObjectURL(url));
      urls.clear();
    };
  }, []);

  const activeImages = images.filter(
    (img) => !(img.kind === "existing" && img.pendingDelete),
  );
  const isPreparingImages = images.some(
    (img) => img.kind === "new" && img.isProcessing,
  );

  const releaseObjectUrl = (url: string | null) => {
    if (!url) return;
    URL.revokeObjectURL(url);
    objectUrlsRef.current.delete(url);
  };

  // 画像ごとの「最後に要求した回転」。処理の完了順が前後しても、
  // 最新の回転の結果だけを反映する（削除済みの画像はMapから消える）。
  const requestedRotationRef = useRef<Map<string, ImageRotation>>(new Map());

  // 元のファイルから、向き補正・回転・縮小したJPEGを作り直して反映する
  const prepareNewImage = async (
    key: string,
    sourceFile: File,
    rotation: ImageRotation,
    previousUrl: string | null,
  ) => {
    requestedRotationRef.current.set(key, rotation);
    try {
      const { blob } = await processImageForUpload(sourceFile, rotation);
      if (requestedRotationRef.current.get(key) !== rotation) return;

      const previewUrl = URL.createObjectURL(blob);
      objectUrlsRef.current.add(previewUrl);
      setImages((prev) =>
        prev.map((img) =>
          img.key === key && img.kind === "new"
            ? {
                ...img,
                processed: blob,
                previewUrl,
                isProcessing: false,
                draftPath: null,
              }
            : img,
        ),
      );
      // 前の向きのプレビューは、表示が切り替わってから解放する
      window.setTimeout(() => releaseObjectUrl(previousUrl), 1000);
    } catch (processingError: unknown) {
      if (requestedRotationRef.current.get(key) !== rotation) return;
      console.error("clothing image processing failed:", processingError);
      requestedRotationRef.current.delete(key);
      releaseObjectUrl(previousUrl);
      setImages((prev) => prev.filter((img) => img.key !== key));
      onError(
        processingError instanceof ImageProcessingError
          ? `${sourceFile.name}: ${processingError.message}`
          : `${sourceFile.name}: 画像を処理できませんでした`,
      );
    }
  };

  const handleRotateNewImage = (item: NewImageItem) => {
    if (item.isProcessing) return;
    const rotation = getNextRotation(item.rotation);
    setImages((prev) =>
      prev.map((img) =>
        img.key === item.key && img.kind === "new"
          ? { ...img, rotation, isProcessing: true }
          : img,
      ),
    );
    void prepareNewImage(item.key, item.sourceFile, rotation, item.previewUrl);
  };

  // 拡大表示中の画像（keyで持ち、回転後も同じ画像を表示し続ける）
  const [lightboxKey, setLightboxKey] = useState<string | null>(null);
  const lightboxImage = images.find((img) => img.key === lightboxKey) ?? null;

  const handleImagesChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files ? Array.from(e.target.files) : [];
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
    if (files.length === 0) return;

    const activeCount = images.filter(
      (img) => !(img.kind === "existing" && img.pendingDelete),
    ).length;
    const remainingSlots = MAX_IMAGE_COUNT - activeCount;

    if (files.length > remainingSlots) {
      onError(
        `画像は合計${MAX_IMAGE_COUNT}枚までです（追加できるのは残り${Math.max(remainingSlots, 0)}枚です）`,
      );
      return;
    }

    onError(null);
    const newItems: NewImageItem[] = files.map((file) => ({
      kind: "new",
      key: crypto.randomUUID(),
      sourceFile: file,
      rotation: 0,
      processed: null,
      previewUrl: null,
      isProcessing: true,
      draftPath: null,
      fromDraft: false,
    }));
    setImages((prev) => [...prev, ...newItems]);
    for (const item of newItems) {
      void prepareNewImage(item.key, item.sourceFile, 0, null);
    }
  };

  // ドラッグ＆ドロップ（PC）／タッチ操作（スマホ）での並び替え。
  // Pointer Eventsはマウス・タッチ・ペンを同じイベントで扱えるため、
  // 新しいライブラリを追加せずにPC/スマホ両対応の並び替えを実装している。
  const itemRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const [draggingKey, setDraggingKey] = useState<string | null>(null);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);

  const isDraggableImage = (img: ImageItem) =>
    !(img.kind === "existing" && img.pendingDelete);

  const registerItemRef = (key: string) => (el: HTMLDivElement | null) => {
    if (el) {
      itemRefs.current.set(key, el);
    } else {
      itemRefs.current.delete(key);
    }
  };

  const moveImageToTarget = (draggedKey: string, targetKey: string) => {
    if (draggedKey === targetKey) return;
    setImages((prev) => {
      const fromIndex = prev.findIndex((img) => img.key === draggedKey);
      const toIndex = prev.findIndex((img) => img.key === targetKey);
      if (fromIndex === -1 || toIndex === -1) return prev;
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
  };

  const handleDragHandlePointerDown = (
    e: React.PointerEvent<HTMLDivElement>,
    key: string,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDraggingKey(key);
    setDragOverKey(key);
  };

  // setPointerCaptureにより、ドラッグ開始後のpointermove/pointerupは
  // ポインタの実際の位置に関わらず常にこのハンドル要素に届く。
  // そのうえで、他の画像要素の中心との距離を比較して最も近いものを
  // ドロップ先として判定する（flex-wrapで複数行になっても機能する）。
  const handleDragHandlePointerMove = (
    e: React.PointerEvent<HTMLDivElement>,
  ) => {
    if (!draggingKey) return;

    let nearestKey: string | null = null;
    let nearestDistance = Infinity;

    itemRefs.current.forEach((el, key) => {
      if (key === draggingKey) return;
      const target = images.find((img) => img.key === key);
      if (!target || !isDraggableImage(target)) return;

      const rect = el.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const distance = Math.hypot(e.clientX - centerX, e.clientY - centerY);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestKey = key;
      }
    });

    setDragOverKey(nearestKey ?? draggingKey);
  };

  const handleDragHandlePointerUp = () => {
    if (draggingKey && dragOverKey && draggingKey !== dragOverKey) {
      moveImageToTarget(draggingKey, dragOverKey);
    }
    setDraggingKey(null);
    setDragOverKey(null);
  };

  const handleRemoveNewImage = (item: NewImageItem) => {
    requestedRotationRef.current.delete(item.key);
    releaseObjectUrl(item.previewUrl);
    setImages((prev) => prev.filter((img) => img.key !== item.key));
  };

  /**
   * 「この画像を削除しますか？」の確認後、削除予定stateに切り替えるだけの処理。
   * ここではDB・Storageへは一切アクセスしない
   * （保存するボタンを押すまで実際の削除は確定しない）。
   */
  const handleMarkImageForDeletion = (item: ExistingImageItem) => {
    setImages((prev) =>
      prev.map((img) =>
        img.key === item.key && img.kind === "existing"
          ? { ...img, pendingDelete: true }
          : img,
      ),
    );
    setConfirmingKey(null);
  };

  /** 削除予定を取り消し、通常の既存画像として復帰させる。 */
  const handleRestoreImage = (item: ExistingImageItem) => {
    setImages((prev) =>
      prev.map((img) =>
        img.key === item.key && img.kind === "existing"
          ? { ...img, pendingDelete: false }
          : img,
      ),
    );
  };

  /** 確認段階をキャンセルする。DB・Storageには一切変更を加えない。 */
  const handleCancelDeleteImage = () => {
    setConfirmingKey(null);
  };

  /**
   * 下書きの写真（保存済みの処理済みJPEG）を、新しく選んだ画像として末尾に加える。
   * 作り直さずにそのまま使い、回転したときだけ元にして作り直す。
   */
  const addDraftImages = (entries: { path: string; blob: Blob }[]) => {
    const newItems: NewImageItem[] = entries.map(({ path, blob }) => {
      const previewUrl = URL.createObjectURL(blob);
      objectUrlsRef.current.add(previewUrl);
      return {
        kind: "new",
        key: crypto.randomUUID(),
        sourceFile: new File([blob], "draft.jpg", { type: "image/jpeg" }),
        rotation: 0,
        processed: blob,
        previewUrl,
        isProcessing: false,
        draftPath: path,
        fromDraft: true,
      };
    });
    setImages((prev) => [...prev, ...newItems].slice(0, MAX_IMAGE_COUNT));
  };

  /** 下書きを保存した後に、各画像の保存先を記録する（次の保存で再アップロードしない） */
  const setDraftPaths = (pathByKey: Record<string, string>) => {
    setImages((prev) =>
      prev.map((img) =>
        img.kind === "new" && pathByKey[img.key]
          ? { ...img, draftPath: pathByKey[img.key] }
          : img,
      ),
    );
  };

  /** 登録完了後などに、画像の選択状態をすべて初期化する */
  const resetImages = () => {
    images.forEach((img) => {
      if (img.kind === "new") {
        requestedRotationRef.current.delete(img.key);
        releaseObjectUrl(img.previewUrl);
      }
    });
    setImages([]);
    setLightboxKey(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  return {
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
    addDraftImages,
    setDraftPaths,
  };
}
