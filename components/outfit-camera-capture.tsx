"use client";

import { Button } from "@/components/ui/button";
import { createBrowserCameraSource } from "@/lib/camera/browser-camera-source";
import { previewLayout } from "@/lib/camera/camera-preview-layout";
import type { PreferenceStorage } from "@/lib/camera/camera-preferences";
import { cameraErrorMessage } from "@/lib/camera/camera-source";
import { createCaptureController } from "@/lib/camera/capture-controller";
import { createManualTrigger } from "@/lib/camera/capture-trigger";
import { createCountdownBeep } from "@/lib/camera/countdown-beep";
import { processImageForOutfitUpload, type ProcessedImage } from "@/lib/image-processing";
import { cn } from "@/lib/utils";
import { useCallback, useEffect, useLayoutEffect, useState, useSyncExternalStore } from "react";

type OutfitCameraCaptureProps = {
  disabled: boolean;
  onPhoto: (image: ProcessedImage) => void;
};

const DEFAULT_FRAME = { width: 1280, height: 720 };

function getStorage(): PreferenceStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

// 流れの判断は controller の仕事。ここは状態を描いて、ボタンを controller につなぐだけ
export function OutfitCameraCapture({ disabled, onPhoto }: OutfitCameraCaptureProps) {
  // 1回だけ作る（レンダーごとに作り直すと、下の後始末が走ってカメラが止まる）
  const [{ controller, trigger, beep }] = useState(() => {
    const trigger = createManualTrigger();
    const beep = createCountdownBeep();
    const controller = createCaptureController({
      source: createBrowserCameraSource(),
      trigger,
      process: (frame, rotation) => processImageForOutfitUpload(frame, rotation),
      storage: getStorage(),
      onTick: (secondsLeft) => beep.beep(secondsLeft),
    });
    return { controller, trigger, beep };
  });

  const state = useSyncExternalStore(controller.subscribe, controller.getState, controller.getState);
  const [frame, setFrame] = useState(DEFAULT_FRAME);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);

  // Activity で隠れたとき、アンマウントのときにカメラを止める
  useLayoutEffect(
    () => () => {
      controller.suspend();
      beep.dispose();
    },
    [controller, beep],
  );

  // 確認の写真の表示 URL。フォームの previewBlob と同じ作り
  const photoBlob = state.photo?.blob ?? null;
  useEffect(() => {
    if (!photoBlob) {
      setPhotoUrl(null);
      return;
    }
    const url = URL.createObjectURL(photoBlob);
    setPhotoUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [photoBlob]);

  // video は全部の phase で置いておき（確認中も映像を止めない）、controller に渡す
  const videoRef = useCallback(
    (video: HTMLVideoElement | null) => controller.attachVideo(video),
    [controller],
  );

  const { phase } = state;
  const layout = previewLayout(frame, state.rotation);
  const showVideo =
    phase === "opening" || phase === "live" || phase === "countdown" || phase === "processing";

  return (
    <div className="flex flex-col gap-3">
      <div
        className={cn("relative overflow-hidden rounded-2xl bg-photo", !showVideo && "hidden")}
        style={{
          width: `min(100%, calc(70vh * ${layout.aspect}))`,
          aspectRatio: `${layout.aspect}`,
        }}
      >
        <video
          ref={videoRef}
          playsInline
          muted
          onLoadedMetadata={(event) =>
            setFrame({
              width: event.currentTarget.videoWidth || DEFAULT_FRAME.width,
              height: event.currentTarget.videoHeight || DEFAULT_FRAME.height,
            })
          }
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            width: `${layout.widthPercent}%`,
            height: `${layout.heightPercent}%`,
            maxWidth: "none",
            transform: layout.transform,
          }}
        />
        {phase === "countdown" && state.secondsLeft !== null && (
          <div
            aria-live="assertive"
            className="absolute inset-0 flex items-center justify-center text-8xl font-semibold text-white drop-shadow-lg"
          >
            {state.secondsLeft}
          </div>
        )}
      </div>

      {phase === "off" && (
        <Button
          type="button"
          variant="outline"
          className="w-fit"
          onClick={() => void controller.start()}
          disabled={disabled}
        >
          カメラで撮る
        </Button>
      )}

      {phase === "opening" && (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-muted-foreground" role="status">
            カメラを準備しています
          </p>
          <Button type="button" variant="outline" onClick={controller.close}>
            閉じる
          </Button>
        </div>
      )}

      {phase === "live" && (
        <div className="flex flex-col gap-3">
          {state.devices.length >= 2 && (
            <select
              aria-label="カメラを選ぶ"
              value={state.deviceId ?? ""}
              onChange={(event) => void controller.selectDevice(event.target.value)}
              className="flex h-9 w-full rounded-lg border border-input bg-card px-3 py-1 text-base transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm"
            >
              {state.devices.map((device) => (
                <option key={device.deviceId} value={device.deviceId}>
                  {device.label}
                </option>
              ))}
            </select>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={controller.rotate}>
              向きを回す
            </Button>
            <Button
              type="button"
              onClick={() => {
                beep.prepare();
                trigger.fire();
              }}
            >
              5秒後に撮る
            </Button>
            <Button type="button" variant="outline" onClick={controller.close}>
              閉じる
            </Button>
          </div>
          {state.message && (
            <p className="text-sm text-muted-foreground" role="status">
              {state.message}
            </p>
          )}
        </div>
      )}

      {phase === "countdown" && (
        <Button type="button" variant="outline" className="w-fit" onClick={controller.cancelCountdown}>
          やめる
        </Button>
      )}

      {phase === "processing" && (
        <p className="text-sm text-muted-foreground" role="status">
          写真を整えています
        </p>
      )}

      {phase === "review" && state.photo && (
        <div className="flex flex-col gap-3">
          {photoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={photoUrl}
              alt="撮った写真"
              className="max-h-96 w-full rounded-2xl bg-photo object-contain"
            />
          )}
          <p className="text-sm text-muted-foreground">
            {state.photo.width}×{state.photo.height}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              onClick={() => {
                const image = controller.keep();
                if (image) onPhoto(image);
              }}
              disabled={disabled}
            >
              この写真を使う
            </Button>
            <Button type="button" variant="outline" onClick={() => void controller.retake()}>
              撮り直す
            </Button>
          </div>
        </div>
      )}

      {phase === "unavailable" && state.errorReason && (
        <div className="flex flex-col gap-3">
          <p role="alert" className="text-sm text-destructive">
            {cameraErrorMessage(state.errorReason)}
          </p>
          <Button
            type="button"
            variant="outline"
            className="w-fit"
            onClick={() => void controller.start()}
          >
            もう一度
          </Button>
        </div>
      )}
    </div>
  );
}
