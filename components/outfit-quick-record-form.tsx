"use client";

import {
  completeOutfitMedia,
  confirmOutfitAction,
  retryOutfitMedia,
  startOutfitPhotoUpload,
} from "@/app/(main)/protected/looks/actions";
import { OutfitItemPicker, type PickerItem } from "@/components/outfit-item-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ImageProcessingError,
  processImageForOutfitUpload,
  type ProcessedImage,
} from "@/lib/image-processing";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

type OutfitQuickRecordFormProps = {
  items: PickerItem[];
  /** 日付の初期値（日本時間の今日）。サーバーで決める */
  defaultWornOn: string;
  /** ?item=<id> で選んでおく服 */
  preselectedItemId: string | null;
};

type UploadPhase = "idle" | "processing" | "uploading" | "failed" | "done";

const UPLOAD_FAILED_MESSAGE = "写真を送れませんでした。もう一度送ってみてください";

// 写真を1枚選ぶ → 送る → 服を選ぶ → 確定、の細い1本の流れ
export function OutfitQuickRecordForm({
  items,
  defaultWornOn,
  preselectedItemId,
}: OutfitQuickRecordFormProps) {
  const router = useRouter();

  // 送り直しでも同じ ID を使うので、画面を開いたときと写真を選んだときに1回だけ作る
  const [clientRequestId] = useState(() => crypto.randomUUID());
  const mediaIdRef = useRef<string | null>(null);
  const processedRef = useRef<ProcessedImage | null>(null);

  const [phase, setPhase] = useState<UploadPhase>("idle");
  const [outfitId, setOutfitId] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [wornOn, setWornOn] = useState(defaultWornOn);
  const [selectedIds, setSelectedIds] = useState<string[]>(() =>
    preselectedItemId && items.some((item) => item.id === preselectedItemId)
      ? [preselectedItemId]
      : [],
  );
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [isConfirming, setIsConfirming] = useState(false);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  // 縮小した写真を Cloudflare へ直接送る（ファイルの欄の名前は file）
  const sendPhoto = async (uploadUrl: string, image: ProcessedImage) => {
    const formData = new FormData();
    formData.append("file", image.blob, "outfit.jpg");
    const response = await fetch(uploadUrl, { method: "POST", body: formData });
    if (!response.ok) throw new Error("upload_failed");
  };

  const complete = async (mediaId: string, image: ProcessedImage) => {
    const result = await completeOutfitMedia({
      mediaId,
      width: image.width,
      height: image.height,
    });
    if ("error" in result) {
      setMessage(result.error);
      setPhase("failed");
      return;
    }
    setMessage(null);
    setPhase("done");
  };

  const upload = async (uploadUrl: string | null, mediaId: string, image: ProcessedImage) => {
    setPhase("uploading");
    setMessage(null);
    try {
      // uploadUrl が null なら、もう届いているので送らずに完了へ進む
      if (uploadUrl) await sendPhoto(uploadUrl, image);
    } catch {
      setMessage(UPLOAD_FAILED_MESSAGE);
      setPhase("failed");
      return;
    }
    await complete(mediaId, image);
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setMessage(null);
    setPhase("processing");
    let image: ProcessedImage;
    try {
      image = await processImageForOutfitUpload(file, 0);
    } catch (error) {
      setMessage(
        error instanceof ImageProcessingError
          ? error.message
          : "画像を処理できませんでした。時間をおいてお試しください",
      );
      setPhase("idle");
      return;
    }

    processedRef.current = image;
    const mediaId = crypto.randomUUID();
    mediaIdRef.current = mediaId;
    setPreviewUrl(URL.createObjectURL(image.blob));

    setPhase("uploading");
    const started = await startOutfitPhotoUpload({ clientRequestId, mediaId, wornOn });
    if ("error" in started) {
      setMessage(started.error);
      setPhase("failed");
      return;
    }
    setOutfitId(started.outfitId);
    await upload(started.uploadUrl, started.mediaId, image);
  };

  const handleRetry = async () => {
    const mediaId = mediaIdRef.current;
    const image = processedRef.current;
    if (!image || !mediaId) return;
    setMessage(null);
    setPhase("uploading");
    const retried = await retryOutfitMedia({ mediaId });
    if ("error" in retried) {
      setMessage(retried.error);
      setPhase("failed");
      return;
    }
    await upload(retried.uploadUrl, mediaId, image);
  };

  // 開始そのものが失敗していたとき用に、同じ ID で開始からやり直す（サーバー側で1回にまとまる）
  const handleRestart = async () => {
    const mediaId = mediaIdRef.current;
    const image = processedRef.current;
    if (!mediaId || !image) return;
    setMessage(null);
    setPhase("uploading");
    const started = await startOutfitPhotoUpload({ clientRequestId, mediaId, wornOn });
    if ("error" in started) {
      setMessage(started.error);
      setPhase("failed");
      return;
    }
    setOutfitId(started.outfitId);
    await upload(started.uploadUrl, started.mediaId, image);
  };

  const handleConfirm = async () => {
    if (!outfitId || phase !== "done" || selectedIds.length === 0) return;
    setIsConfirming(true);
    setMessage(null);
    const result = await confirmOutfitAction({
      outfitId,
      expectedRevision: 0,
      wornOn,
      itemIds: selectedIds,
      note: note.trim() || null,
    });
    if ("error" in result) {
      setMessage(result.error);
      setIsConfirming(false);
      return;
    }
    if (result.status === "stale") {
      setMessage("ほかの画面で先に変更されました。最新の内容を表示します");
      setTimeout(() => router.push(`/protected/looks/${outfitId}`), 1500);
      return;
    }
    router.push(`/protected/looks/${outfitId}`);
  };

  const canConfirm = phase === "done" && selectedIds.length > 0 && !isConfirming;

  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="look-photo-title" className="flex flex-col gap-3">
        <h2 id="look-photo-title" className="text-base font-semibold">
          1. 着画を選ぶ
        </h2>
        {previewUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={previewUrl}
            alt="選んだ着画"
            className="max-h-96 w-full rounded-2xl bg-photo object-contain"
          />
        )}
        <Input
          type="file"
          accept="image/*"
          onChange={handleFileChange}
          disabled={phase === "processing" || phase === "uploading"}
          aria-label="着画の写真を選ぶ"
        />
        <p className="text-sm text-muted-foreground" role="status">
          {phase === "processing" && "写真を整えています"}
          {phase === "uploading" && "写真を送っています"}
          {phase === "done" && "写真が届きました"}
        </p>
        {phase === "failed" && (
          <Button
            type="button"
            variant="outline"
            className="w-fit"
            onClick={outfitId ? handleRetry : handleRestart}
          >
            もう一度送る
          </Button>
        )}
      </section>

      <section aria-labelledby="look-date-title" className="flex flex-col gap-2">
        <h2 id="look-date-title" className="text-base font-semibold">
          2. 着た日
        </h2>
        <Label htmlFor="look-worn-on" className="sr-only">
          着た日
        </Label>
        <Input
          id="look-worn-on"
          type="date"
          value={wornOn}
          onChange={(e) => setWornOn(e.target.value)}
          className="w-fit"
        />
      </section>

      <section aria-labelledby="look-items-title" className="flex flex-col gap-3">
        <h2 id="look-items-title" className="text-base font-semibold">
          3. 着た服を選ぶ
        </h2>
        <OutfitItemPicker items={items} selectedIds={selectedIds} onChange={setSelectedIds} />
      </section>

      <section aria-labelledby="look-note-title" className="flex flex-col gap-2">
        <h2 id="look-note-title" className="text-base font-semibold">
          メモ（なくてもだいじょうぶです）
        </h2>
        <Input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={500}
          aria-label="メモ"
        />
      </section>

      {message && (
        <p role="alert" className="text-sm text-destructive">
          {message}
        </p>
      )}

      <Button type="button" onClick={handleConfirm} disabled={!canConfirm} className="w-full">
        {isConfirming ? "確定しています" : "確定"}
      </Button>
      {phase !== "done" && (
        <p className="text-xs text-muted-foreground">
          写真が届いて、服を1つ以上選ぶと確定できます
        </p>
      )}
    </div>
  );
}
