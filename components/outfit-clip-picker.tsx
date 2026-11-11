"use client";

import { Button } from "@/components/ui/button";
import { previewLayout } from "@/lib/camera/camera-preview-layout";
import type { CaptureClip } from "@/lib/camera/capture-controller";
import { frameFromVideo } from "@/lib/camera/video-frame";
import type { ImageRotation } from "@/lib/image-processing";
import { useEffect, useRef, useState } from "react";

type OutfitClipPickerProps = {
  clip: CaptureClip;
  rotation: ImageRotation;
  message: string | null;
  disabled: boolean;
  onUseFrame: (frame: Blob) => void;
  onRetake: () => void;
};

const STEP_SECONDS = 0.1;
const START_RATIO = 0.6; // 最初は動画の6割あたり（全身が収まっていることが多い）

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

// recloset-YYYYMMDD-HHMMSS.mp4（webm なら .webm）
function downloadName(blob: Blob): string {
  const now = new Date();
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(
    now.getHours(),
  )}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `recloset-${stamp}.${blob.type.includes("mp4") ? "mp4" : "webm"}`;
}

// 録った動画から、いちばんよいコマを選ぶ。コマの切り出しは video-frame、保存の流れは controller の仕事
export function OutfitClipPicker({
  clip,
  rotation,
  message,
  disabled,
  onUseFrame,
  onRetake,
}: OutfitClipPickerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [frame, setFrame] = useState({ width: 1280, height: 720 });
  const [duration, setDuration] = useState(clip.durationSec);
  const [time, setTime] = useState(0);
  const [busy, setBusy] = useState(false);

  // picking を離れる（アンマウント・動画の差し替え）ときに URL を解放する
  useEffect(() => {
    const objectUrl = URL.createObjectURL(clip.blob);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [clip.blob]);

  const layout = previewLayout(frame, rotation);

  function seek(next: number) {
    const video = videoRef.current;
    if (!video) return;
    const clamped = Math.min(Math.max(next, 0), duration);
    video.pause();
    video.currentTime = clamped;
    setTime(clamped);
  }

  function handleLoadedMetadata(video: HTMLVideoElement) {
    setFrame({
      width: video.videoWidth || 1280,
      height: video.videoHeight || 720,
    });
    if (Number.isFinite(video.duration)) {
      setDuration(video.duration);
      return;
    }
    // MediaRecorder の webm は長さが無限と出ることがある。端まで飛ばして長さを確定させる
    const fix = () => {
      video.removeEventListener("timeupdate", fix);
      const real = Number.isFinite(video.duration) ? video.duration : clip.durationSec;
      setDuration(real);
      video.currentTime = real * START_RATIO;
    };
    video.addEventListener("timeupdate", fix);
    video.currentTime = 1e101;
  }

  function handleCanPlayFirst(video: HTMLVideoElement) {
    if (!Number.isFinite(video.duration)) return; // 上の処理が位置を決める
    video.currentTime = video.duration * START_RATIO;
  }

  async function pickCurrentFrame() {
    const video = videoRef.current;
    if (!video || busy) return;
    setBusy(true);
    try {
      video.pause();
      if (video.seeking) {
        await new Promise<void>((resolve) =>
          video.addEventListener("seeked", () => resolve(), { once: true }),
        );
      }
      onUseFrame(await frameFromVideo(video));
    } catch {
      // 切り出せなかったときは、もう一度押せるようにする
    } finally {
      setBusy(false);
    }
  }

  function saveVideo() {
    if (!url) return;
    const link = document.createElement("a");
    link.href = url;
    link.download = downloadName(clip.blob);
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  return (
    <div className="flex flex-col gap-3">
      <div
        className="relative overflow-hidden rounded-2xl bg-photo"
        style={{
          width: `min(100%, calc(70vh * ${layout.aspect}))`,
          aspectRatio: `${layout.aspect}`,
        }}
      >
        {url && (
          <video
            ref={videoRef}
            src={url}
            autoPlay
            loop
            muted
            playsInline
            onLoadedMetadata={(event) => handleLoadedMetadata(event.currentTarget)}
            onLoadedData={(event) => {
              // 最初の位置に一度だけ移す
              if (time === 0) handleCanPlayFirst(event.currentTarget);
            }}
            onTimeUpdate={(event) => {
              if (!event.currentTarget.paused) setTime(event.currentTarget.currentTime);
            }}
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
        )}
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-sm text-muted-foreground">いちばんよいコマを選んでください</p>
        <input
          type="range"
          aria-label="コマを選ぶ"
          min={0}
          max={duration}
          step={0.05}
          value={Math.min(time, duration)}
          onChange={(event) => seek(Number(event.target.value))}
          className="w-full accent-primary"
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => seek(time - STEP_SECONDS)}>
            ◀ 0.1秒
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => seek(time + STEP_SECONDS)}>
            0.1秒 ▶
          </Button>
          <span className="text-xs text-muted-foreground">
            {time.toFixed(1)} / {duration.toFixed(1)}秒
          </span>
        </div>
      </div>

      {message && (
        <p className="text-sm text-muted-foreground" role="status">
          {message}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={() => void pickCurrentFrame()} disabled={disabled || busy}>
          このコマで記録
        </Button>
        <Button type="button" variant="outline" onClick={onRetake}>
          撮り直す
        </Button>
        <Button type="button" variant="outline" onClick={saveVideo}>
          この端末に保存
        </Button>
      </div>
    </div>
  );
}
