"use client";

import { rememberPhotoRegisteredNotice } from "@/components/draft-saved-notice";
import { EntryModeSelector } from "@/components/entry-mode-selector";
import { LeaveConfirmDialog } from "@/components/leave-confirm-dialog";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useLeaveGuard } from "@/components/use-leave-guard";
import {
  getNextRotation,
  ImageProcessingError,
  processImageForUpload,
  type ImageRotation,
} from "@/lib/image-processing";
import {
  createConcurrencyLimiter,
  createPhotoItemTarget,
  discardIncompletePhotoItem,
  MAX_PHOTO_BATCH_SIZE,
  PHOTO_PROCESSING_CONCURRENCY,
  registerPhotoItem,
} from "@/lib/photo-batch-registration";
import {
  canDiscardPhoto,
  canStartPhotoRegistration,
  describePhotoFailure,
  getPhotoBatchLeaveMessage,
  getPhotoRegisterButtonLabel,
  isPhotoLocked,
  isPhotoToRegister,
  planPhotoAddition,
  resolveDiscardResult,
  shouldConfirmPhotoBatchLeave,
  summarizePhotoBatch,
  type PhotoBatchItemState,
} from "@/lib/photo-batch-state";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { AlertCircle, Check, ImagePlus, Loader2, RotateCw, X } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

// 写真からまとめて登録（写真1枚＝1着、最大20枚、AIは呼ばない）。
// 写真の変換は最大2枚ずつ、保存は1着ずつ順に行う（lib/photo-batch-registration.ts）。
// 各写真の保存先（服ID・画像パス）は最初の登録で決め、再試行でも変えない。

type PhotoBatchPhoto = PhotoBatchItemState & {
  key: string;
  fileName: string;
  /** 回転したときに作り直すための元のファイル（変更しない） */
  sourceFile: File;
  rotation: ImageRotation;
  /** 変換済みのJPEG（プレビューと保存の両方に使う） */
  processed: Blob | null;
  previewUrl: string | null;
};

const ACCEPTED_TYPES = "image/jpeg,image/png,image/webp,image/heic,image/heif";

export function PhotoBatchRegisterForm({
  onSwitchToNormal,
  leaveGuardEnabled = true,
  otherEntryDirty = false,
  onPendingChange,
}: {
  /** 「通常登録」を選んだとき */
  onSwitchToNormal: () => void;
  /** 離脱の確認をこの画面で行うか（新規登録ページで隠れているときはfalse） */
  leaveGuardEnabled?: boolean;
  /** 通常登録の画面に、保存していない入力がある（離脱の確認に含める） */
  otherEntryDirty?: boolean;
  /** 登録していない写真の有無が変わったとき（新規登録ページで離脱の確認をまとめるため） */
  onPendingChange?: (pending: boolean) => void;
}) {
  const router = useRouter();
  const [photos, setPhotos] = useState<PhotoBatchPhoto[]>([]);
  const [notices, setNotices] = useState<string[]>([]);
  const [isRegistering, setIsRegistering] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [resultMessage, setResultMessage] = useState<string | null>(null);
  // 取り消しの確認中・片付け中の写真
  const [discardKey, setDiscardKey] = useState<string | null>(null);
  const [discardingKey, setDiscardingKey] = useState<string | null>(null);
  // 写真ごとの補足（取り消せなかった理由など）
  const [photoNotes, setPhotoNotes] = useState<Record<string, string>>({});
  const registeringRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // 変換は画面全体で最大2枚まで同時に行う（追加・回転の依頼が別々に届いても）
  const limiterRef = useRef(createConcurrencyLimiter(PHOTO_PROCESSING_CONCURRENCY));
  // 写真ごとの「最後に依頼した回転」。完了順が前後しても最新の結果だけを使う
  const requestedRotationRef = useRef(new Map<string, ImageRotation>());

  // プレビュー用のURLは、外す・作り直す・画面を離れるときに解放する
  const objectUrlsRef = useRef(new Set<string>());
  useEffect(() => {
    const urls = objectUrlsRef.current;
    return () => {
      urls.forEach((url) => URL.revokeObjectURL(url));
      urls.clear();
    };
  }, []);
  const releaseUrl = (url: string | null) => {
    if (!url) return;
    URL.revokeObjectURL(url);
    objectUrlsRef.current.delete(url);
  };

  const updatePhoto = (key: string, change: Partial<PhotoBatchPhoto>) => {
    setPhotos((prev) => prev.map((photo) => (photo.key === key ? { ...photo, ...change } : photo)));
  };

  const isBusy = isRegistering || discardingKey !== null;
  const hasPending = shouldConfirmPhotoBatchLeave(photos, isRegistering);
  useEffect(() => {
    onPendingChange?.(hasPending);
  }, [hasPending, onPendingChange]);
  const leaveGuard = useLeaveGuard(leaveGuardEnabled && (hasPending || otherEntryDirty));

  const prepare = (key: string, sourceFile: File, rotation: ImageRotation, previousUrl: string | null) => {
    requestedRotationRef.current.set(key, rotation);
    void limiterRef.current(() => processImageForUpload(sourceFile, rotation)).then(
      ({ blob }) => {
        if (requestedRotationRef.current.get(key) !== rotation) return;
        const previewUrl = URL.createObjectURL(blob);
        objectUrlsRef.current.add(previewUrl);
        updatePhoto(key, { processed: blob, previewUrl, status: "ready" });
        window.setTimeout(() => releaseUrl(previousUrl), 1000);
      },
      (error: unknown) => {
        if (requestedRotationRef.current.get(key) !== rotation) return;
        console.error("photo batch processing failed:", error);
        requestedRotationRef.current.delete(key);
        releaseUrl(previousUrl);
        // 変換できない写真は登録できないため一覧から外し、理由を表示する
        setPhotos((prev) => prev.filter((photo) => photo.key !== key));
        setNotices((prev) => [
          ...prev,
          error instanceof ImageProcessingError
            ? `${sourceFile.name}: ${error.message}`
            : `${sourceFile.name}: 画像を処理できませんでした`,
        ]);
      },
    );
  };

  const handleFilesChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files ? Array.from(e.target.files) : [];
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (files.length === 0 || registeringRef.current || discardingKey !== null) return;

    const { accept, rejected } = planPhotoAddition(photos.length, files.length);
    const accepted = files.slice(0, accept);
    setNotices(
      rejected > 0
        ? [`写真は${MAX_PHOTO_BATCH_SIZE}枚までです。${rejected}枚は追加しませんでした`]
        : [],
    );
    setResultMessage(null);
    const added: PhotoBatchPhoto[] = accepted.map((file) => ({
      key: crypto.randomUUID(),
      fileName: file.name,
      sourceFile: file,
      rotation: 0,
      processed: null,
      previewUrl: null,
      status: "processing",
      target: null,
      failure: null,
    }));
    // 選んだ順に、今の写真の後ろへ並べる
    setPhotos((prev) => [...prev, ...added]);
    for (const photo of added) prepare(photo.key, photo.sourceFile, 0, null);
  };

  // 保存前の写真を外す（DB・Storageには何も送っていない）
  const handleRemove = (photo: PhotoBatchPhoto) => {
    if (registeringRef.current || isPhotoLocked(photo)) return;
    requestedRotationRef.current.delete(photo.key);
    releaseUrl(photo.previewUrl);
    setPhotos((prev) => prev.filter((p) => p.key !== photo.key));
  };

  const handleRotate = (photo: PhotoBatchPhoto) => {
    if (registeringRef.current || isPhotoLocked(photo) || photo.status === "processing") return;
    const rotation = getNextRotation(photo.rotation);
    updatePhoto(photo.key, { rotation, status: "processing" });
    prepare(photo.key, photo.sourceFile, rotation, photo.previewUrl);
  };

  // 保存に失敗した写真の登録をやめる。確認のうえで片付け（画像の紐づいていない服・
  // 参照されていない画像ファイルだけを消す）、片付けられたときだけ一覧から外す。
  // 完了済み・編集済み・確認できないデータは消さない
  const handleDiscardConfirmed = async () => {
    const photo = photos.find((p) => p.key === discardKey);
    setDiscardKey(null);
    if (!photo || !canDiscardPhoto(photo) || registeringRef.current || discardingKey) return;
    setDiscardingKey(photo.key);
    setPhotoNotes((prev) => ({ ...prev, [photo.key]: "" }));
    try {
      const supabase = createClient();
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();
      const outcome =
        userError || !user || !photo.target
          ? resolveDiscardResult({ ok: false, reason: "unknown" })
          : resolveDiscardResult(
              await discardIncompletePhotoItem(supabase, { userId: user.id, target: photo.target }),
            );
      if (outcome.action === "remove") {
        requestedRotationRef.current.delete(photo.key);
        releaseUrl(photo.previewUrl);
        setPhotos((prev) => prev.filter((p) => p.key !== photo.key));
        return;
      }
      if (outcome.action === "saved") {
        updatePhoto(photo.key, { status: "saved", failure: null });
      }
      setPhotoNotes((prev) => ({ ...prev, [photo.key]: outcome.message }));
    } finally {
      setDiscardingKey(null);
    }
  };

  const handleRegister = async () => {
    if (registeringRef.current || discardingKey || !canStartPhotoRegistration(photos, false)) {
      return;
    }
    registeringRef.current = true;
    setIsRegistering(true);
    setResultMessage(null);
    setNotices([]);
    setPhotoNotes({});
    let isLeaving = false;

    try {
      const supabase = createClient();
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();
      if (userError || !user) {
        setResultMessage("ログイン情報が確認できませんでした。もう一度お試しください");
        return;
      }

      // 送る写真と保存先を決める（保存先は一度決めたら変えない）
      const queue = photos
        .filter(isPhotoToRegister)
        .map((photo) => ({
          key: photo.key,
          target: photo.target ?? createPhotoItemTarget(user.id),
          image: photo.processed as Blob,
        }));
      const targetByKey = new Map(queue.map((entry) => [entry.key, entry.target]));
      setPhotos((prev) =>
        prev.map((photo) =>
          targetByKey.has(photo.key) ? { ...photo, target: targetByKey.get(photo.key)! } : photo,
        ),
      );

      // 1着ずつ順に保存する。失敗しても次の写真へ進む
      let succeeded = 0;
      setProgress({ done: 0, total: queue.length });
      for (let i = 0; i < queue.length; i++) {
        const entry = queue[i];
        updatePhoto(entry.key, { status: "saving", failure: null });
        const result = await registerPhotoItem(supabase, {
          userId: user.id,
          target: entry.target,
          image: entry.image,
        });
        if (result.ok) {
          succeeded += 1;
          updatePhoto(entry.key, { status: "saved", failure: null });
        } else {
          console.error("photo batch registration failed:", result);
          updatePhoto(entry.key, {
            status: "failed",
            failure: { stage: result.stage, retryable: result.retryable, reason: result.reason },
          });
        }
        setProgress({ done: i + 1, total: queue.length });
      }

      const before = summarizePhotoBatch(photos);
      const savedTotal = before.saved + succeeded;
      if (savedTotal === photos.length) {
        // すべて保存できた。Closetで「◯着を登録しました」を一度だけ表示する
        isLeaving = true;
        leaveGuard.allowLeave();
        rememberPhotoRegisteredNotice(savedTotal);
        router.push("/protected/items");
        return;
      }
      setResultMessage(
        `${savedTotal}着を登録しました。${photos.length - savedTotal}枚は登録できませんでした。` +
          "理由は写真の下に表示しています",
      );
    } catch (error) {
      console.error("photo batch registration error:", error);
      setResultMessage("登録を続けられませんでした。登録できた服はそのまま残っています");
    } finally {
      if (!isLeaving) {
        registeringRef.current = false;
        setIsRegistering(false);
        setProgress(null);
      }
    }
  };

  const summary = summarizePhotoBatch(photos);
  const canRegister = canStartPhotoRegistration(photos, isBusy);
  const canAddMore = !isBusy && photos.length < MAX_PHOTO_BATCH_SIZE;
  // 送れる写真が残っていないとき（保存済みと、再試行できない失敗だけ）は登録ボタンを出さない
  // 写真が0枚のときも出さない（「写真を選ぶ」が最初の操作）
  const showRegisterButton =
    photos.length > 0 && (summary.processing > 0 || summary.toRegister > 0 || isRegistering);
  const discardTarget = photos.find((p) => p.key === discardKey) ?? null;

  return (
    <div className="flex flex-col gap-6">
      <LeaveConfirmDialog
        {...leaveGuard.dialog}
        description={getPhotoBatchLeaveMessage({ items: photos, isRegistering, otherEntryDirty })}
      />
      <LeaveConfirmDialog
        open={discardTarget !== null}
        title="この写真の登録を取り消しますか？"
        description="登録の途中で止まっているデータを片付けて、一覧から外します。登録が完了していた場合や、別の画面で編集した場合は消しません。"
        confirmLabel="取り消す"
        cancelLabel="やめる"
        onCancel={() => setDiscardKey(null)}
        onConfirm={() => void handleDiscardConfirmed()}
      />
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">服を登録</CardTitle>
          <CardDescription>クローゼットに新しいアイテムを追加します</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <EntryModeSelector
            isPhotoOnly
            onChange={(photoOnly) => {
              if (!photoOnly) onSwitchToNormal();
            }}
            disabled={isBusy}
          />
          <p className="-mt-2 text-xs text-muted-foreground">
            写真1枚につき1着として登録します（{MAX_PHOTO_BATCH_SIZE}枚まで）。あとから情報や写真を追加できます
          </p>

          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED_TYPES}
            multiple
            className="sr-only"
            tabIndex={-1}
            aria-hidden="true"
            onChange={handleFilesChange}
          />
          <Button
            type="button"
            variant={photos.length === 0 ? "default" : "outline"}
            className="min-h-11"
            disabled={!canAddMore}
            onClick={() => fileInputRef.current?.click()}
          >
            <ImagePlus className="h-4 w-4" aria-hidden="true" />
            {photos.length === 0
              ? "写真を選ぶ"
              : `写真を追加（${photos.length}/${MAX_PHOTO_BATCH_SIZE}枚）`}
          </Button>

          {/* 変換できなかった写真・枚数の上限は、写真が多くても見えるよう一覧の上に出す */}
          {notices.length > 0 && (
            <ul role="alert" className="flex flex-col gap-1 text-sm text-destructive">
              {notices.map((notice, i) => (
                <li key={i} className="[overflow-wrap:anywhere]">
                  {notice}
                </li>
              ))}
            </ul>
          )}

          {photos.length > 0 && (
            <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4" aria-label="選んだ写真">
              {photos.map((photo, index) => (
                <PhotoThumbnail
                  key={photo.key}
                  photo={photo}
                  index={index}
                  disabled={isBusy}
                  isDiscarding={discardingKey === photo.key}
                  note={photoNotes[photo.key] || null}
                  onRemove={() => handleRemove(photo)}
                  onRotate={() => handleRotate(photo)}
                  onDiscard={() => setDiscardKey(photo.key)}
                />
              ))}
            </ul>
          )}

          {resultMessage && !isRegistering && (
            <p role="alert" className="text-sm text-destructive [overflow-wrap:anywhere]">
              {resultMessage}
            </p>
          )}

          {showRegisterButton ? (
            // 写真が多くてもスクロールせずに押せるよう、画面の下（スマホは下部ナビの上）に留める
            <div className="sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] z-10 -mx-6 -mb-6 flex flex-col gap-2 rounded-b-xl border-t bg-card/95 px-6 py-3 backdrop-blur md:bottom-0">
              {progress && (
                <div role="status" aria-live="polite" className="flex flex-col gap-1">
                  <p className="text-sm font-medium">
                    {progress.done} / {progress.total}着 登録中…
                  </p>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden="true">
                    <div
                      className="h-full rounded-full bg-primary motion-safe:transition-[width]"
                      style={{ width: `${Math.round((progress.done / Math.max(progress.total, 1)) * 100)}%` }}
                    />
                  </div>
                </div>
              )}
              <Button
                type="button"
                className="min-h-11 w-full"
                disabled={!canRegister}
                onClick={() => void handleRegister()}
              >
                {isRegistering
                  ? "登録中..."
                  : summary.processing > 0
                    ? "写真を準備しています..."
                    : getPhotoRegisterButtonLabel(photos)}
              </Button>
            </div>
          ) : (
            summary.saved > 0 && (
              <div className="flex flex-col gap-2">
                {/* 写真だけで登録した服に、続けてカテゴリ・季節を付けられる */}
                <Button asChild className="min-h-11">
                  <Link href="/protected/items/classify">
                    クイック仕分けでカテゴリ・季節を付ける
                  </Link>
                </Button>
                <Button asChild variant="outline" className="min-h-11">
                  <Link href="/protected/items">Closetで登録した服を見る</Link>
                </Button>
              </div>
            )
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function PhotoThumbnail({
  photo,
  index,
  disabled,
  isDiscarding,
  note,
  onRemove,
  onRotate,
  onDiscard,
}: {
  photo: PhotoBatchPhoto;
  index: number;
  disabled: boolean;
  isDiscarding: boolean;
  /** 取り消せなかった理由など */
  note: string | null;
  onRemove: () => void;
  onRotate: () => void;
  onDiscard: () => void;
}) {
  const locked = disabled || isPhotoLocked(photo);
  const busy = photo.status === "processing" || photo.status === "saving" || isDiscarding;
  const label = `${index + 1}枚目`;
  const failed = photo.status === "failed" && photo.failure;

  return (
    <li className="flex flex-col gap-1">
      <div className="relative aspect-square overflow-hidden rounded-md border bg-muted">
        {photo.previewUrl ? (
          <Image
            src={photo.previewUrl}
            alt={label}
            fill
            sizes="(min-width: 640px) 25vw, 33vw"
            className={cn("object-cover", photo.status === "saved" && "opacity-80")}
            unoptimized
          />
        ) : (
          <span className="sr-only">{label}（準備中）</span>
        )}

        {busy && (
          <span className="absolute inset-0 flex items-center justify-center bg-background/50">
            <Loader2 className="h-6 w-6 motion-safe:animate-spin" aria-hidden="true" />
            <span className="sr-only">
              {isDiscarding ? "取り消し中" : photo.status === "saving" ? "登録中" : "準備中"}
            </span>
          </span>
        )}
        {photo.status === "saved" && (
          <span className="absolute bottom-1 left-1 flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground">
            <Check className="h-4 w-4" aria-hidden="true" />
            <span className="sr-only">登録済み</span>
          </span>
        )}
        {failed && (
          <span className="absolute left-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-destructive text-destructive-foreground">
            <AlertCircle className="h-4 w-4" aria-hidden="true" />
            <span className="sr-only">登録できませんでした</span>
          </span>
        )}

        {!locked && !busy && (
          <>
            <button
              type="button"
              onClick={onRemove}
              aria-label={`${label}を外す`}
              className="absolute right-1 top-1 flex h-8 w-8 items-center justify-center rounded-full bg-background/90 shadow"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={onRotate}
              aria-label={`${label}を回転`}
              className="absolute bottom-1 right-1 flex h-8 w-8 items-center justify-center rounded-full bg-background/90 shadow"
            >
              <RotateCw className="h-4 w-4" aria-hidden="true" />
            </button>
          </>
        )}
      </div>

      {/* 失敗した写真だけ、理由と「取り消す」を出す（再試行は下の登録ボタンでまとめて行う） */}
      {failed && photo.failure && (
        <div className="flex flex-col gap-1">
          <p className="text-[11px] leading-snug text-destructive [overflow-wrap:anywhere]">
            {describePhotoFailure(photo.failure)}
          </p>
          {canDiscardPhoto(photo) && (
            <button
              type="button"
              onClick={onDiscard}
              disabled={disabled || isDiscarding}
              className="-my-1 min-h-8 w-fit py-1 text-xs text-muted-foreground underline underline-offset-2 disabled:opacity-50"
            >
              取り消す
            </button>
          )}
        </div>
      )}
      {note && (
        <p role="status" className="text-[11px] leading-snug text-muted-foreground [overflow-wrap:anywhere]">
          {note}
        </p>
      )}
    </li>
  );
}
