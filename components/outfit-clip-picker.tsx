"use client";

import { Button } from "@/components/ui/button";
import { canPickFrame } from "@/lib/camera/can-pick-frame";
import { previewLayout } from "@/lib/camera/camera-preview-layout";
import type { CaptureClip } from "@/lib/camera/capture-controller";
import { frameFromVideo } from "@/lib/camera/video-frame";
import {
  processImageForOutfitUpload,
  type ImageRotation,
  type ProcessedImage,
} from "@/lib/image-processing";
import {
  addPickedFrame,
  MAX_PICKED_FRAMES,
  removePickedFrame,
  type PickedFrame,
} from "@/lib/outfits/clip-frames";
import { createGeneration } from "@/lib/outfits/async-generation";
import { useEffect, useRef, useState } from "react";

type OutfitClipPickerProps = {
  clip: CaptureClip;
  rotation: ImageRotation;
  /** 選んだコマの列（持ち主はフォーム。決定のあとに戻ってきても残る） */
  frames: PickedFrame<ProcessedImage>[];
  onFramesChange: (frames: PickedFrame<ProcessedImage>[]) => void;
  keepVideo: boolean;
  onKeepVideoChange: (keep: boolean) => void;
  disabled: boolean;
  onDecide: () => void;
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
  frames,
  onFramesChange,
  keepVideo,
  onKeepVideoChange,
  disabled,
  onDecide,
  onRetake,
}: OutfitClipPickerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [frame, setFrame] = useState({ width: 1280, height: 720 });
  const [duration, setDuration] = useState(clip.durationSec);
  const [time, setTime] = useState(0);
  const [busy, setBusy] = useState(false);
  const [playing, setPlaying] = useState(true);
  const [pickable, setPickable] = useState(false);
  const seekedOnce = useRef(false);
  const [message, setMessage] = useState<string | null>(null);
  // 追加の処理（切り出し・縮小）は時間がかかる。終わったときの最新の列と、まだ画面にいるかを見る
  const framesRef = useRef(frames);
  framesRef.current = frames;
  // 隠れる（Activity）・撮り直す・消えるたびに世代を進め、古い追加の結果は捨てる。
  // 再び表示されたときは busy を戻す（途中だった追加は世代が古いので無視される）
  const [generation] = useState(createGeneration);
  useEffect(() => {
    setBusy(false);
    return () => {
      generation.bump();
    };
  }, [generation]);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});

  // 選んだコマのサムネイル。列が変わるたびに作り直し、前のものは解放する
  useEffect(() => {
    const next: Record<string, string> = {};
    for (const f of frames) next[f.id] = URL.createObjectURL(f.image.blob);
    setThumbs(next);
    return () => {
      for (const u of Object.values(next)) URL.revokeObjectURL(u);
    };
  }, [frames]);

  // 絵が出ていて、シーク中でないときだけ「このコマで記録」を押せる
  function refreshPickable(video: HTMLVideoElement) {
    setPickable(
      canPickFrame({
        readyState: video.readyState,
        seeking: video.seeking,
        hasSeekedOnce: seekedOnce.current,
      }),
    );
  }

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
    refreshPickable(video);
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

  // 今のコマを選んだ列に足す。切り出し・縮小は写真と同じ処理（向きもここで反映する）
  async function addCurrentFrame() {
    const video = videoRef.current;
    if (!video || busy) return;
    const myGeneration = generation.current();
    setBusy(true);
    setMessage(null);
    try {
      video.pause();
      if (video.seeking) {
        await new Promise<void>((resolve) =>
          video.addEventListener("seeked", () => resolve(), { once: true }),
        );
      }
      const timeSec = video.currentTime;
      const image = await processImageForOutfitUpload(await frameFromVideo(video), rotation);
      // 処理を待つあいだに画面を離れたら、結果は捨てる。列は終わった時点の最新のものに足す
      if (!generation.isCurrent(myGeneration)) return;
      const { list, result } = addPickedFrame(framesRef.current, { id: crypto.randomUUID(), timeSec, image });
      if (result === "added") onFramesChange(list);
      else if (result === "duplicate") setMessage("ほぼ同じ場面はもう選んであります");
      else setMessage(`選べるのは${MAX_PICKED_FRAMES}枚までです`);
    } catch {
      if (generation.isCurrent(myGeneration)) setMessage("コマを切り出せませんでした。もう一度お試しください");
    } finally {
      if (generation.isCurrent(myGeneration)) setBusy(false);
    }
  }

  function handleRetake() {
    // 選んだコマも動画も捨てて撮り直す
    generation.bump();
    onRetake();
  }

  function togglePlay() {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) void video.play().catch(() => undefined);
    else video.pause();
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
              refreshPickable(event.currentTarget);
            }}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onSeeking={(event) => refreshPickable(event.currentTarget)}
            onSeeked={(event) => {
              seekedOnce.current = true;
              refreshPickable(event.currentTarget);
            }}
            onCanPlay={(event) => refreshPickable(event.currentTarget)}
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
        <p className="text-sm text-muted-foreground">
          よいコマを選んで追加してください（動画は何度でも見直せます）
        </p>
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
          <Button type="button" variant="outline" size="sm" onClick={togglePlay}>
            {playing ? "一時停止" : "再生"}
          </Button>
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

      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium">
          選んだコマ {frames.length}/{MAX_PICKED_FRAMES}
        </p>
        {frames.length > 0 ? (
          <ul className="flex flex-wrap gap-2">
            {frames.map((f, index) => (
              <li key={f.id} className="relative">
                <button
                  type="button"
                  aria-label={`${index + 1}枚目（${f.timeSec.toFixed(1)}秒）の場面に移る`}
                  onClick={() => seek(f.timeSec)}
                  className="block h-16 w-16 overflow-hidden rounded-lg bg-photo outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {thumbs[f.id] && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={thumbs[f.id]} alt="" className="h-full w-full object-cover" />
                  )}
                </button>
                <button
                  type="button"
                  aria-label={`${index + 1}枚目を外す`}
                  disabled={disabled || busy}
                  onClick={() => onFramesChange(removePickedFrame(frames, f.id))}
                  className="absolute -right-1.5 -top-1.5 flex h-6 w-6 items-center justify-center rounded-full bg-foreground text-xs text-background"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted-foreground">
            動画を動かして、よいコマで「このコマを追加」を押してください
          </p>
        )}
      </div>

      <label className="flex min-h-10 items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={keepVideo}
          onChange={(event) => onKeepVideoChange(event.target.checked)}
          className="h-4 w-4 accent-primary"
        />
        動画も残す
      </label>

      {message && (
        <p className="text-sm text-muted-foreground" role="status">
          {message}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={() => void addCurrentFrame()} disabled={disabled || busy || !pickable || frames.length >= MAX_PICKED_FRAMES}>
          このコマを追加
        </Button>
        <Button type="button" onClick={onDecide} disabled={disabled || busy || frames.length === 0}>
          {frames.length}枚で決定
        </Button>
        <Button type="button" variant="outline" onClick={handleRetake} disabled={disabled || busy}>
          撮り直す
        </Button>
        <Button type="button" variant="outline" onClick={saveVideo}>
          この端末に保存
        </Button>
      </div>
      {frames.length > 0 && (
        <p className="text-xs text-muted-foreground">「撮り直す」を押すと、選んだコマも消えます</p>
      )}
    </div>
  );
}
