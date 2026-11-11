"use client";

import {
  addOutfitMediaUpload,
  completeOutfitMedia,
  confirmOutfitAction,
  retryOutfitMedia,
  startOutfitPhotoUpload,
} from "@/app/(main)/protected/looks/actions";
import { OutfitCameraCapture } from "@/components/outfit-camera-capture";
import { OutfitClipPicker } from "@/components/outfit-clip-picker";
import { OutfitItemPicker, type PickerItem } from "@/components/outfit-item-picker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { CaptureClip } from "@/lib/camera/capture-controller";
import {
  ImageProcessingError,
  type ImageRotation,
  processImageForOutfitUpload,
  type ProcessedImage,
} from "@/lib/image-processing";
import type { PickedFrame } from "@/lib/outfits/clip-frames";
import {
  applyBackgroundToImage,
  BACKGROUND_FAILED_MESSAGE,
} from "@/lib/outfits/frame-background-browser";
import {
  reconcileProcessed,
  resolveSendImage,
  type BackgroundMode,
  type ProcessedMap,
} from "@/lib/outfits/frame-background";
import { planMediaUploads } from "@/lib/outfits/upload-plan";
import {
  judgeLibraryVideo,
  LIBRARY_VIDEO_MESSAGES,
  libraryVideoUploadName,
} from "@/lib/outfits/library-video";
import { probeVideoFile } from "@/lib/outfits/library-video-browser";
import {
  mergePickedPhotos,
  photoSelectionNotice,
  planPhotoSelection,
} from "@/lib/outfits/photo-selection";
import { removePickedFrame } from "@/lib/outfits/clip-frames";
import { rotateStaged, stagePhoto, type StagedPhoto } from "@/lib/outfits/photo-rotation";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

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
const VIDEO_FAILED_MESSAGE = "動画を送れませんでした";

const BACKGROUND_OPTIONS: { mode: BackgroundMode; label: string }[] = [
  { mode: "none", label: "そのまま" },
  { mode: "blur", label: "ぼかす" },
  { mode: "white", label: "白" },
];

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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const photosInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  // 選び直し・確定・リセットのたびに進める。処理を待つあいだに状況が変わったら、古い結果は捨てる
  const selectionEpochRef = useRef(0);

  // 送る前の確認中の写真。向きを回せるのはここにいる間だけ。
  // 下書きの作成とアップロードは「この写真を使う」を押したときに1回だけ行う
  // （回すたびに下書きを作ると、使われない未確定の着画が溜まるため）。
  // source は元の写真（ファイル、またはカメラで撮った縮小済みの写真）。回すたびに元から作り直す
  const [staged, setStaged] = useState<(StagedPhoto<Blob> & { image: ProcessedImage }) | null>(null);
  const [stagedUrl, setStagedUrl] = useState<string | null>(null);
  const stagedBlob = staged?.image.blob ?? null;
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
  // 増やすと撮影の部品が作り直される（カウントダウンも確認中の写真もやめる）
  const [cameraKey, setCameraKey] = useState(0);
  // 撮り直しのとき、撮影の部品を開いてすぐカメラを起こす
  const [autoStartCamera, setAutoStartCamera] = useState(false);

  // 動画モード：録った動画は、確定・リセット・撮り直しまでフォームが持つ。
  // 選んだコマの送信は「確定」のときだけ（コマ選びの途中で下書きを作らない）
  // fromLibrary：端末から選んだ動画（「この端末に保存」を出さず、反転しないで見せる）
  const [clip, setClip] = useState<{
    clip: CaptureClip;
    rotation: ImageRotation;
    fromLibrary: boolean;
    name?: string;
  } | null>(null);
  // 端末の写真を複数選んだ流れ（動画なし）。選んだ列を動画のコマと同じ列で持つ
  const [photoSet, setPhotoSet] = useState(false);
  // 端末の動画の確認中・写真の処理中
  const [libraryBusy, setLibraryBusy] = useState(false);
  const [frames, setFrames] = useState<PickedFrame<ProcessedImage>[]>([]);
  const [keepVideo, setKeepVideo] = useState(true);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [sendStatus, setSendStatus] = useState<string | null>(null);
  const [frameUrls, setFrameUrls] = useState<Record<string, string>>({});
  // 選んだコマの背景（全部のコマに同じ設定）。処理済みの写真は設定ごとに作り、確定のときはそれを送る
  const [bgMode, setBgMode] = useState<BackgroundMode>("none");
  const [bgProcessed, setBgProcessed] = useState<ProcessedMap<ProcessedImage>>({});
  const bgProcessedRef = useRef<ProcessedMap<ProcessedImage>>({});
  // 送信の再開用：コマごとの mediaId（コマの id）、動画の mediaId、送り終えたもの
  const videoMediaIdRef = useRef<string | null>(null);
  const doneMediaRef = useRef<Set<string>>(new Set());
  const videoDoneRef = useRef(false);
  const videoFailedRef = useRef(false);

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

  useEffect(() => {
    if (!stagedBlob) {
      setStagedUrl(null);
      return;
    }
    const url = URL.createObjectURL(stagedBlob);
    setStagedUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [stagedBlob]);

  // 背景を整える：設定やコマが変わったら、処理済みを整理して、足りない分を1枚ずつ作る。
  // 1枚ごとに画面へ返すので、6枚でも固まらない。設定やコマがまた変わったら、前の続きはやめる
  useEffect(() => {
    if (pickerOpen) return;
    const frameIds = frames.map((f) => f.id);
    const { keep, pending } = reconcileProcessed(bgProcessedRef.current, frameIds, bgMode);
    bgProcessedRef.current = keep;
    setBgProcessed(keep);
    if (bgMode === "none" || pending.length === 0) return;

    let cancelled = false;
    const mode = bgMode;
    void (async () => {
      for (const id of pending) {
        const frame = frames.find((f) => f.id === id);
        if (!frame) continue;
        try {
          const image = await applyBackgroundToImage(frame.image, mode);
          if (cancelled) return;
          bgProcessedRef.current = { ...bgProcessedRef.current, [id]: { mode, image } };
          setBgProcessed(bgProcessedRef.current);
        } catch (error) {
          if (cancelled) return;
          // 失敗したら一言出して「そのまま」に戻す（記録は止めない）
          setMessage(error instanceof ImageProcessingError ? error.message : BACKGROUND_FAILED_MESSAGE);
          setBgMode("none");
          return;
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [frames, bgMode, pickerOpen]);

  // 決定したコマの表示（picker を閉じているあいだの横並び）。背景を整えてあれば、その写真を見せる
  useEffect(() => {
    const next: Record<string, string> = {};
    for (const f of frames) {
      const shown = resolveSendImage(f.id, f.image, bgProcessed, bgMode) ?? f.image;
      next[f.id] = URL.createObjectURL(shown.blob);
    }
    setFrameUrls(next);
    return () => {
      for (const u of Object.values(next)) URL.revokeObjectURL(u);
    };
  }, [frames, bgProcessed, bgMode]);

  // 選んでいる服のうち、今の一覧にあるものだけ（消えた服は外れる）
  const validSelectedIds = selectedIds.filter((id) => items.some((item) => item.id === id));
  const entryItemIds = () =>
    preselectedItemId && items.some((item) => item.id === preselectedItemId)
      ? [preselectedItemId]
      : [];

  // 入口を切り替える共通の処理：進めている取り込み（端末の動画の確認・写真の処理）の世代を進めて捨て、
  // 「読み込んでいます」も解除する。新しい取り込みを始めるとき・動画や写真の流れに入るとき・リセットで必ず通す。
  // 返した世代は、取り込みが終わったときに「まだ自分が最新か」を確かめるのに使う
  const switchEntry = () => {
    selectionEpochRef.current += 1;
    setLibraryBusy(false);
    return selectionEpochRef.current;
  };

  // 動画・選んだコマ・送信の進み具合を全部捨てる
  const discardClip = () => {
    switchEntry();
    setPhotoSet(false);
    setClip(null);
    setFrames([]);
    setKeepVideo(true);
    setPickerOpen(false);
    setSendStatus(null);
    setBgMode("none");
    bgProcessedRef.current = {};
    setBgProcessed({});
    videoMediaIdRef.current = null;
    doneMediaRef.current = new Set();
    videoDoneRef.current = false;
    videoFailedRef.current = false;
  };

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
    setStaged(null);
    setWornOn(defaultWornOn);
    setSelectedIds(entryItemIds());
    setNote("");
    setMessage(null);
    setIsConfirming(false);
    discardClip();
    setAutoStartCamera(false);
    setCameraKey((k) => k + 1);
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

  // 処理に成功した写真で、下書きごと作り直す（ファイルでもカメラでも同じ）
  const beginDraft = async (image: ProcessedImage) => {
    setOutfitId(null);
    startedMediaIdRef.current = null;
    clientRequestIdRef.current = crypto.randomUUID();
    processedRef.current = image;
    const mediaId = crypto.randomUUID();
    mediaIdRef.current = mediaId;
    setPreviewBlob(image.blob);
    await start(mediaId, image);
  };

  // 動画を録り終えた。写真1枚の流れの下書きは使わないので捨てて、コマ選びを開く
  const handleClip = useCallback((next: CaptureClip, rotation: ImageRotation, fromLibrary = false, name?: string) => {
    switchEntry();
    setPhotoSet(false);
    clientRequestIdRef.current = crypto.randomUUID();
    startedMediaIdRef.current = null;
    mediaIdRef.current = null;
    processedRef.current = null;
    setOutfitId(null);
    setPhase("idle");
    setPreviewBlob(null);
    setStaged(null);
    setMessage(null);
    setFrames([]);
    setKeepVideo(true);
    setSendStatus(null);
    setBgMode("none");
    bgProcessedRef.current = {};
    setBgProcessed({});
    videoMediaIdRef.current = crypto.randomUUID();
    doneMediaRef.current = new Set();
    videoDoneRef.current = false;
    videoFailedRef.current = false;
    setAutoStartCamera(false);
    setClip({ clip: next, rotation, fromLibrary, name });
    setPickerOpen(true);
  }, []);

  // 端末の動画を選んだ。使えるか確かめて、よければカメラで録り終えたときと同じ入口（handleClip）に合流する。
  // 向きは回転の値 0 で渡す：ブラウザが <video> の表示も canvas への描画も回転後の向きで返すため（二重に回さない）
  const handleVideoFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || isConfirmingRef.current) return;
    setMessage(null);
    const epoch = switchEntry();
    // 大きさは読み込む前に見る（大きすぎる動画を開かない）
    const tooLarge = judgeLibraryVideo({ sizeBytes: file.size, durationSec: 1 });
    if (!tooLarge.ok) return setMessage(LIBRARY_VIDEO_MESSAGES[tooLarge.reason]);
    setLibraryBusy(true);
    let verdict;
    try {
      const { durationSec } = await probeVideoFile(file);
      verdict = { durationSec, ...judgeLibraryVideo({ sizeBytes: file.size, durationSec }) };
    } catch {
      verdict = { durationSec: 0, ok: false as const, reason: "unreadable" as const };
    }
    if (epoch !== selectionEpochRef.current) return;
    setLibraryBusy(false);
    // 選べなかったときは、今の状態をそのまま残して一言だけ出す（選び直せる）
    if (!verdict.ok) return setMessage(LIBRARY_VIDEO_MESSAGES[verdict.reason]);
    setAutoStartCamera(false);
    setCameraKey((k) => k + 1);
    handleClip({ blob: file, durationSec: verdict.durationSec }, 0, true, file.name);
  };

  // 端末の写真を複数選んだ。今の列（動画のコマ）があれば後ろに足し、なければ写真だけの列を始める。
  // 処理は写真1枚の流れと同じ（向き・長辺2560・JPEG 0.9）。6枚を超える分は無視する
  const handlePhotosChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length === 0 || isConfirmingRef.current) return;
    setMessage(null);
    const fresh = clip === null && !photoSet;
    const base = fresh ? [] : frames;
    const { take, ignored } = planPhotoSelection(base.length, files.length);
    if (take === 0) return setMessage(photoSelectionNotice({ ignored, failed: 0 }));
    const epoch = switchEntry();
    setLibraryBusy(true);
    const done: { id: string; image: ProcessedImage }[] = [];
    let failed = 0;
    let lastError: string | null = null;
    for (const file of files.slice(0, take)) {
      try {
        done.push({ id: crypto.randomUUID(), image: await processImageForOutfitUpload(file, 0) });
      } catch (error) {
        failed += 1;
        lastError = error instanceof ImageProcessingError ? error.message : null;
      }
      if (epoch !== selectionEpochRef.current) return;
    }
    setLibraryBusy(false);
    const notice = photoSelectionNotice({ ignored, failed });
    if (done.length === 0) return setMessage(failed === 1 && lastError ? lastError : notice);
    if (fresh) {
      // 写真1枚の流れの下書きは使わないので捨てる（動画のときと同じ）
      clientRequestIdRef.current = crypto.randomUUID();
      startedMediaIdRef.current = null;
      mediaIdRef.current = null;
      processedRef.current = null;
      setOutfitId(null);
      setPhase("idle");
      setPreviewBlob(null);
      setStaged(null);
      setSendStatus(null);
      setBgMode("none");
      bgProcessedRef.current = {};
      setBgProcessed({});
      doneMediaRef.current = new Set();
      setAutoStartCamera(false);
      setCameraKey((k) => k + 1);
      setPhotoSet(true);
      setPickerOpen(false);
    }
    // 取り込み中はコマの変更を止めているが、念のため完了時点の最新の列に足し、上限もその列で見る
    setFrames((latest) => mergePickedPhotos(fresh ? [] : latest, done).list);
    setMessage(notice);
  };

  // 動画と選んだコマを全部捨てて、カメラに戻る
  const handleRetakeClip = () => {
    if (isConfirmingRef.current) return;
    const fromLibrary = clip?.fromLibrary ?? false;
    discardClip();
    setOutfitId(null);
    // 端末から選んだ動画は、カメラではなく動画の選び直しに戻る
    if (fromLibrary) {
      videoInputRef.current?.click();
      return;
    }
    clientRequestIdRef.current = crypto.randomUUID();
    setAutoStartCamera(true);
    setCameraKey((k) => k + 1);
  };

  const handleCameraPhoto = (image: ProcessedImage) => {
    if (isConfirmingRef.current || phase === "processing" || phase === "uploading") return;
    setMessage(null);
    discardClip();
    setAutoStartCamera(false);
    // カメラの確認はここで閉じ、送る前の確認（向きを回せる）に渡す
    setCameraKey((k) => k + 1);
    setStaged({ ...stagePhoto<Blob>(image.blob), image });
  };

  // 元の写真を指定の向きで処理して、確認中の写真にする。失敗したら今の確認中の写真・下書きはそのまま
  const stageFrom = async (staging: StagedPhoto<Blob>) => {
    const previousPhase = phase;
    setMessage(null);
    setPhase("processing");
    try {
      const image = await processImageForOutfitUpload(staging.source, staging.rotation);
      setStaged({ ...staging, image });
      discardClip(); // 写真1枚の流れに切り替える
    } catch (error) {
      setMessage(
        error instanceof ImageProcessingError
          ? error.message
          : "画像を処理できませんでした。時間をおいてお試しください",
      );
    }
    setPhase(previousPhase);
  };

  const handleRotate = () => {
    if (!staged || isConfirmingRef.current || phase === "processing" || phase === "uploading") return;
    void stageFrom(rotateStaged(staged));
  };

  const handleUseStaged = () => {
    if (!staged || isConfirmingRef.current || phase === "processing" || phase === "uploading") return;
    const image = staged.image;
    setStaged(null);
    void beginDraft(image);
  };

  // 写真を選ぶたびに、下書きごと作り直す（1つの下書きに写真は1枚だけ）
  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || isConfirmingRef.current) return;
    setAutoStartCamera(false);
    setCameraKey((k) => k + 1);

    // 処理に失敗したら、できあがっている下書きや確認中の写真はそのまま残す
    await stageFrom(stagePhoto<Blob>(file));
  };

  const handleRetry = async () => {
    // 確認中の別の写真があるときは、前の写真を送り直さない（使うなら新しい下書きで送る）
    if (isConfirmingRef.current || staged) return;
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

  // 確定の呼び出しと、そのあとの移動（写真1枚の流れも動画の流れも共通）。
  // 呼ぶ前に isConfirming を立てておく。移動しない結果のときは、ここで解除する
  const runConfirm = async (targetOutfitId: string, notice: string | null) => {
    let navigating = false;
    try {
      const result = await confirmOutfitAction({
        outfitId: targetOutfitId,
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
      const target = `/protected/looks/${targetOutfitId}`;
      if (result.status === "stale" || notice) {
        setMessage(
          result.status === "stale"
            ? "ほかの画面で先に変更されました。最新の内容を表示します"
            : notice,
        );
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

  const handleConfirm = async () => {
    if (isConfirmingRef.current || libraryBusy) return;
    if (!outfitId || phase !== "done" || validSelectedIds.length === 0) return;
    isConfirmingRef.current = true;
    setIsConfirming(true);
    setMessage(null);
    await runConfirm(outfitId, null);
  };

  // 1つ送る：アップロード URL をもらう → 送る → 完了。失敗したら、画面に出す文を返す（成功は null）。
  // 同じ mediaId で何度呼んでもよい（サーバーが送り直しに回す）
  const sendOne = async (input: {
    kind: "photo" | "video";
    mediaId: string;
    blob: Blob;
    filename: string;
    size?: { width: number; height: number };
    request: () => Promise<{ mediaId: string; uploadUrl: string | null } | { error: string }>;
  }): Promise<string | null> => {
    try {
      const started = await input.request();
      if ("error" in started) return started.error;
      if (started.uploadUrl) {
        const formData = new FormData();
        formData.append("file", input.blob, input.filename);
        const response = await fetch(started.uploadUrl, { method: "POST", body: formData });
        if (!response.ok) return input.kind === "photo" ? UPLOAD_FAILED_MESSAGE : VIDEO_FAILED_MESSAGE;
      }
      const done = await completeOutfitMedia({
        mediaId: input.mediaId,
        ...(input.size ? input.size : {}),
      });
      if ("error" in done) return done.error;
      return null;
    } catch {
      return input.kind === "photo" ? UPLOAD_FAILED_MESSAGE : VIDEO_FAILED_MESSAGE;
    }
  };

  // 背景を整え中（今の設定で処理済みでないコマがある）。終わるまで確定しない
  const bgBusy =
    bgMode !== "none" &&
    reconcileProcessed(bgProcessed, frames.map((f) => f.id), bgMode).pending.length > 0;

  // 動画モードの確定：選んだ写真と動画をここで送ってから、確定する。
  // 写真が失敗したら止める（もう一度押すと、送り終えたものを飛ばして続きから）。
  // 動画が失敗しても、写真と記録は確定する
  const handleConfirmWithClip = async () => {
    if (isConfirmingRef.current || libraryBusy) return;
    if (!multiMode || pickerOpen || frames.length === 0 || validSelectedIds.length === 0) return;
    // 背景を整え終わるまで送らない（元の写真は送らない）
    if (bgBusy) return;
    isConfirmingRef.current = true;
    setIsConfirming(true);
    setMessage(null);

    const plan = planMediaUploads({ photoCount: frames.length, keepVideo: clip !== null && keepVideo });
    let draftId = outfitId;
    for (const step of plan) {
      if (step.kind === "photo") {
        const frame = frames[step.photoIndex as number];
        if (doneMediaRef.current.has(frame.id)) continue;
        const sendImage = resolveSendImage(frame.id, frame.image, bgProcessed, bgMode);
        if (!sendImage) {
          setMessage(BACKGROUND_FAILED_MESSAGE);
          setSendStatus(null);
          isConfirmingRef.current = false;
          setIsConfirming(false);
          return;
        }
        setSendStatus(`写真を送っています ${(step.photoIndex as number) + 1}/${frames.length}`);
        const error = await sendOne({
          kind: "photo",
          mediaId: frame.id,
          blob: sendImage.blob,
          filename: "outfit.jpg",
          size: { width: sendImage.width, height: sendImage.height },
          request: async () => {
            if (step.createsDraft) {
              const started = await startOutfitPhotoUpload({
                clientRequestId: clientRequestIdRef.current,
                mediaId: frame.id,
                wornOn,
              });
              if ("error" in started) return started;
              draftId = started.outfitId;
              setOutfitId(started.outfitId);
              return { mediaId: started.mediaId, uploadUrl: started.uploadUrl };
            }
            return addOutfitMediaUpload({
              outfitId: draftId as string,
              mediaId: frame.id,
              kind: "photo",
              sortOrder: step.sortOrder,
            });
          },
        });
        if (error) {
          setMessage(error);
          setSendStatus(null);
          isConfirmingRef.current = false;
          setIsConfirming(false);
          return;
        }
        doneMediaRef.current.add(frame.id);
      } else if (clip && !videoDoneRef.current) {
        const videoMediaId = videoMediaIdRef.current as string;
        setSendStatus("動画を送っています");
        const error = await sendOne({
          kind: "video",
          mediaId: videoMediaId,
          blob: clip.clip.blob,
          filename: clip.fromLibrary
            ? libraryVideoUploadName({ type: clip.clip.blob.type, name: clip.name })
            : clip.clip.blob.type.includes("mp4")
              ? "outfit.mp4"
              : "outfit.webm",
          request: () =>
            addOutfitMediaUpload({
              outfitId: draftId as string,
              mediaId: videoMediaId,
              kind: "video",
              sortOrder: step.sortOrder,
            }),
        });
        if (error) videoFailedRef.current = true;
        else videoDoneRef.current = true;
      }
    }
    setSendStatus(null);
    if (!draftId) {
      setMessage(UPLOAD_FAILED_MESSAGE);
      isConfirmingRef.current = false;
      setIsConfirming(false);
      return;
    }
    await runConfirm(
      draftId,
      videoFailedRef.current && !videoDoneRef.current
        ? "動画は送れませんでした。写真と記録は保存しました"
        : null,
    );
  };

  // 動画モード：コマを決めてあり、服を選んであれば確定できる（送るのは確定のとき）。
  // 下書きができたあと（送信を始めたあと）は、コマの選び直しを止める（使われない写真が下書きに残らないように）
  // multiMode：動画のコマ、または端末の複数の写真を、選んだ列として持つ流れ（確定のとき送る）
  const videoMode = clip !== null;
  const multiMode = clip !== null || photoSet;
  const videoLocked = multiMode && outfitId !== null;
  const canConfirm = multiMode
    ? !pickerOpen && frames.length > 0 && validSelectedIds.length > 0 && !isConfirming && !bgBusy && !libraryBusy
    : !staged && phase === "done" && validSelectedIds.length > 0 && !isConfirming && !libraryBusy;

  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="look-photo-title" className="flex flex-col gap-3">
        <h2 id="look-photo-title" className="text-base font-semibold">
          1. 写真を選ぶ
        </h2>
        {!multiMode && (stagedUrl ?? previewUrl) && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={(stagedUrl ?? previewUrl) as string}
            alt="選んだ着画"
            className="max-h-96 w-full rounded-2xl bg-photo object-contain"
          />
        )}
        {staged && (
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={handleRotate}
              disabled={isConfirming || libraryBusy || phase === "processing" || phase === "uploading"}
            >
              向きを回す
            </Button>
            <Button
              type="button"
              onClick={handleUseStaged}
              disabled={isConfirming || libraryBusy || phase === "processing" || phase === "uploading"}
            >
              この写真を使う
            </Button>
          </div>
        )}
        {videoMode && clip && pickerOpen && (
          <OutfitClipPicker
            clip={clip.clip}
            rotation={clip.rotation}
            frames={frames}
            onFramesChange={setFrames}
            keepVideo={keepVideo}
            onKeepVideoChange={setKeepVideo}
            disabled={isConfirming || libraryBusy}
            onDecide={() => setPickerOpen(false)}
            onRetake={handleRetakeClip}
            fromLibrary={clip.fromLibrary}
          />
        )}
        {multiMode && !pickerOpen && (
          <div className="flex flex-col gap-3">
            <ul className="flex gap-2 overflow-x-auto pb-1" aria-label="選んだ写真">
              {frames.map((f, index) => (
                <li key={f.id} className="relative shrink-0">
                  {frameUrls[f.id] && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={frameUrls[f.id]}
                      alt={`選んだ写真 ${index + 1}`}
                      className="h-28 w-auto rounded-xl bg-photo object-contain"
                    />
                  )}
                  {photoSet && !videoLocked && (
                    <button
                      type="button"
                      aria-label={`${index + 1}枚目を外す`}
                      disabled={isConfirming || libraryBusy}
                      onClick={() => setFrames(removePickedFrame(frames, f.id))}
                      className="absolute -right-1.5 -top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-foreground text-xs text-background"
                    >
                      ×
                    </button>
                  )}
                </li>
              ))}
              {videoMode && keepVideo && (
                <li className="flex h-28 w-20 shrink-0 items-center justify-center rounded-xl bg-secondary text-sm text-muted-foreground">
                  動画
                </li>
              )}
            </ul>
            <div className="flex flex-col gap-2">
              <span id="look-bg-label" className="text-sm font-medium">
                背景
              </span>
              <div role="group" aria-labelledby="look-bg-label" className="flex flex-wrap gap-2">
                {BACKGROUND_OPTIONS.map((option) => (
                  <Button
                    key={option.mode}
                    type="button"
                    size="sm"
                    variant={bgMode === option.mode ? "default" : "outline"}
                    aria-pressed={bgMode === option.mode}
                    onClick={() => setBgMode(option.mode)}
                    disabled={isConfirming || libraryBusy || videoLocked}
                  >
                    {option.label}
                  </Button>
                ))}
              </div>
              {bgBusy && (
                <p className="text-sm text-muted-foreground" role="status">
                  背景を整えています…
                </p>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              写真 {frames.length}枚{videoMode && keepVideo ? "と動画" : ""}を、確定のときに送ります
            </p>
            {videoMode && !videoLocked && (
              <Button
                type="button"
                variant="outline"
                className="w-fit"
                onClick={() => setPickerOpen(true)}
                disabled={isConfirming || libraryBusy}
              >
                動画に戻って選び直す
              </Button>
            )}
          </div>
        )}
        {sendStatus && (
          <p className="text-sm text-muted-foreground" role="status">
            {sendStatus}
          </p>
        )}
        {!pickerOpen && (
          <Button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isConfirming || libraryBusy || phase === "processing" || phase === "uploading"}
            className="w-fit"
          >
            写真を1枚選ぶ
          </Button>
        )}
        {!pickerOpen && (
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => photosInputRef.current?.click()}
              disabled={isConfirming || libraryBusy || phase === "processing" || phase === "uploading" || videoLocked}
            >
              写真をまとめて選ぶ（6枚まで）
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => videoInputRef.current?.click()}
              disabled={isConfirming || libraryBusy || phase === "processing" || phase === "uploading" || videoLocked}
            >
              動画から選ぶ
            </Button>
          </div>
        )}
        {libraryBusy && (
          <p className="text-sm text-muted-foreground" role="status">
            読み込んでいます…
          </p>
        )}
        <div className={videoMode ? "hidden" : undefined}>
          <OutfitCameraCapture
            key={cameraKey}
            disabled={isConfirming || libraryBusy || phase === "processing" || phase === "uploading"}
            onPhoto={handleCameraPhoto}
            onClip={handleClip}
            autoStart={autoStartCamera}
          />
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleFileChange}
          disabled={isConfirming || libraryBusy || phase === "processing" || phase === "uploading"}
          aria-label="着画の写真を1枚選ぶ"
          className="hidden"
        />
        <input
          ref={photosInputRef}
          type="file"
          accept="image/*"
          multiple
          onChange={handlePhotosChange}
          aria-label="着画の写真をまとめて選ぶ"
          className="hidden"
        />
        <input
          ref={videoInputRef}
          type="file"
          accept="video/*"
          onChange={handleVideoFileChange}
          aria-label="着画の動画を選ぶ"
          className="hidden"
        />
        <p className="text-sm text-muted-foreground" role="status">
          {phase === "processing" && "写真を整えています"}
          {phase === "uploading" && "写真を送っています"}
          {phase === "done" && "写真が届きました"}
        </p>
        {phase === "failed" && !staged && (
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

      <section aria-labelledby="look-items-title" className="flex flex-col gap-3">
        <h2 id="look-items-title" className="text-base font-semibold">
          2. 着た服を選ぶ
        </h2>
        <OutfitItemPicker items={items} selectedIds={validSelectedIds} onChange={setSelectedIds}
          disabled={isConfirming}
        />
      </section>

      <section aria-labelledby="look-date-title" className="flex flex-col gap-2">
        <h2 id="look-date-title" className="text-base font-semibold">
          3. 着た日
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

      <section aria-labelledby="look-note-title" className="flex flex-col gap-2">
        <h2 id="look-note-title" className="text-base font-semibold">
          メモ（任意）
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

      <Button
        type="button"
        onClick={multiMode ? handleConfirmWithClip : handleConfirm}
        disabled={!canConfirm} className="w-full">
        {isConfirming ? "確定しています" : "確定"}
      </Button>
      {!canConfirm && !isConfirming && (
        <p className="text-xs text-muted-foreground">
          {videoMode
            ? "コマを決めて、服を選ぶと確定できます"
            : multiMode
              ? "写真が1枚以上あり、服を選ぶと確定できます"
              : "写真と服を選ぶと確定できます"}
        </p>
      )}
    </div>
  );
}
