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

const CONFIRM_FAILED_MESSAGE = "うまく進められませんでした。時間をおいて、もう一度お試しください";
const UPLOAD_FAILED_MESSAGE = "写真を送れませんでした。もう一度送ってみてください";

// 写真を1枚選ぶ → 送る → 服を選ぶ → 確定、の細い1本の流れ
export function OutfitQuickRecordForm({
  items,
  defaultWornOn,
  preselectedItemId,
}: OutfitQuickRecordFormProps) {
  const router = useRouter();

  // 送り直しでも同じ ID を使うので、写真を選んだとき（と確定後のリセット）に1回だけ作り直す
  const clientRequestIdRef = useRef<string>("");
  if (!clientRequestIdRef.current) clientRequestIdRef.current = crypto.randomUUID();
  const isConfirmingRef = useRef(false);
  const startedMediaIdRef = useRef<string | null>(null);
  const mediaIdRef = useRef<string | null>(null);
  const processedRef = useRef<ProcessedImage | null>(null);

  const [phase, setPhase] = useState<UploadPhase>("idle");
  const [outfitId, setOutfitId] = useState<string | null>(null);
  // 縮小した写真。表示用の URL は、これをもとに effect の中で作る
  const [previewBlob, setPreviewBlob] = useState<Blob | null>(null);
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

  // Activity で隠れると effect の後始末が走り、また表示されると作り直される。
  // 作った URL をその場で解放するので、戻ってきたときも新しい URL で表示できる
  useEffect(() => {
    if (!previewBlob) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(previewBlob);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [previewBlob]);

  // 選んでいる服のうち、今の一覧にあるものだけ（消えた服は外れる）
  const validSelectedIds = selectedIds.filter((id) => items.some((item) => item.id === id));
  const entryItemIds = () =>
    preselectedItemId && items.some((item) => item.id === preselectedItemId)
      ? [preselectedItemId]
      : [];

  // 確定のあとは新しい入力に戻す。キャッシュされた画面（Activity）に戻ったときに、
  // 「確定しています」のままや前の写真が残らないようにする（previewUrl を消すと、古い blob も解放される）
  const resetForm = () => {
    clientRequestIdRef.current = crypto.randomUUID();
    startedMediaIdRef.current = null;
    mediaIdRef.current = null;
    processedRef.current = null;
    isConfirmingRef.current = false;
    setPhase("idle");
    setOutfitId(null);
    setPreviewBlob(null);
    setWornOn(defaultWornOn);
    setSelectedIds(entryItemIds());
    setNote("");
    setMessage(null);
    setIsConfirming(false);
  };

  // 縮小した写真を Cloudflare へ直接送る（ファイルの欄の名前は file）
  const sendPhoto = async (uploadUrl: string, image: ProcessedImage) => {
    const formData = new FormData();
    formData.append("file", image.blob, "outfit.jpg");
    const response = await fetch(uploadUrl, { method: "POST", body: formData });
    if (!response.ok) throw new Error("upload_failed");
  };

  // 開始・完了・送り直しの呼び出しが失敗（通信の切断など）しても、同じ ID で送り直せる状態に戻す
  const fail = (text: string) => {
    setMessage(text);
    setPhase("failed");
  };

  const complete = async (mediaId: string, image: ProcessedImage) => {
    try {
      const result = await completeOutfitMedia({
        mediaId,
        width: image.width,
        height: image.height,
      });
      if ("error" in result) return fail(result.error);
    } catch {
      return fail(UPLOAD_FAILED_MESSAGE);
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
      return fail(UPLOAD_FAILED_MESSAGE);
    }
    await complete(mediaId, image);
  };

  // この mediaId をまだ開始していないときだけ、開始からやり直す（サーバー側で1回にまとまる）
  const start = async (mediaId: string, image: ProcessedImage) => {
    setPhase("uploading");
    setMessage(null);
    let started;
    try {
      started = await startOutfitPhotoUpload({
        clientRequestId: clientRequestIdRef.current,
        mediaId,
        wornOn,
      });
    } catch {
      return fail(UPLOAD_FAILED_MESSAGE);
    }
    if ("error" in started) return fail(started.error);
    startedMediaIdRef.current = started.mediaId;
    setOutfitId(started.outfitId);
    await upload(started.uploadUrl, started.mediaId, image);
  };

  // 写真を選ぶたびに、下書きごと作り直す（1つの下書きに写真は1枚だけ）
  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || isConfirmingRef.current) return;

    // 処理に失敗したら、できあがっている下書きはそのまま残す
    const previousPhase = phase;
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
      setPhase(previousPhase);
      return;
    }

    // 処理に成功してから、下書きごと作り直す
    setOutfitId(null);
    startedMediaIdRef.current = null;
    clientRequestIdRef.current = crypto.randomUUID();
    processedRef.current = image;
    const mediaId = crypto.randomUUID();
    mediaIdRef.current = mediaId;
    setPreviewBlob(image.blob);
    await start(mediaId, image);
  };

  const handleRetry = async () => {
    if (isConfirmingRef.current) return;
    const mediaId = mediaIdRef.current;
    const image = processedRef.current;
    if (!image || !mediaId) return;
    // この mediaId が開始済みでなければ、開始からやり直す
    if (startedMediaIdRef.current !== mediaId) return start(mediaId, image);

    setMessage(null);
    setPhase("uploading");
    let retried;
    try {
      retried = await retryOutfitMedia({ mediaId });
    } catch {
      return fail(UPLOAD_FAILED_MESSAGE);
    }
    if ("error" in retried) return fail(retried.error);
    await upload(retried.uploadUrl, mediaId, image);
  };

  const handleConfirm = async () => {
    if (isConfirmingRef.current) return;
    if (!outfitId || phase !== "done" || validSelectedIds.length === 0) return;
    isConfirmingRef.current = true;
    setIsConfirming(true);
    setMessage(null);
    let navigating = false;
    try {
      const result = await confirmOutfitAction({
        outfitId,
        expectedRevision: 0,
        wornOn,
        itemIds: validSelectedIds,
        note: note.trim() || null,
      });
      if ("error" in result) {
        setMessage(result.error);
        return;
      }
      navigating = true;
      const target = `/protected/looks/${outfitId}`;
      if (result.status === "stale") {
        setMessage("ほかの画面で先に変更されました。最新の内容を表示します");
        // 操作はロックしたまま少し見せてから、リセットして移動する
        setTimeout(() => {
          resetForm();
          router.push(target);
        }, 1500);
        return;
      }
      resetForm();
      router.push(target);
    } catch {
      setMessage(CONFIRM_FAILED_MESSAGE);
    } finally {
      if (!navigating) {
        isConfirmingRef.current = false;
        setIsConfirming(false);
      }
    }
  };

  const canConfirm = phase === "done" && validSelectedIds.length > 0 && !isConfirming;

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
          disabled={isConfirming || phase === "processing" || phase === "uploading"}
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
            onClick={handleRetry}
            disabled={isConfirming}
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
          disabled={isConfirming}
          className="w-fit"
        />
      </section>

      <section aria-labelledby="look-items-title" className="flex flex-col gap-3">
        <h2 id="look-items-title" className="text-base font-semibold">
          3. 着た服を選ぶ
        </h2>
        <OutfitItemPicker items={items} selectedIds={validSelectedIds} onChange={setSelectedIds}
          disabled={isConfirming}
        />
      </section>

      <section aria-labelledby="look-note-title" className="flex flex-col gap-2">
        <h2 id="look-note-title" className="text-base font-semibold">
          メモ（なくてもだいじょうぶです）
        </h2>
        <Input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          disabled={isConfirming}
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
      {!canConfirm && !isConfirming && (
        <p className="text-xs text-muted-foreground">
          写真が届いて、服を1つ以上選ぶと確定できます
        </p>
      )}
    </div>
  );
}
