// 実物のカメラ（getUserMedia）。流れの判断はここに書かない（controller の仕事）。

import { createReadyGate } from "@/lib/camera/camera-ready-gate";
import { recordingNeedsRotation, rotatedSize } from "@/lib/camera/clip-rotation";
import type { ImageRotation } from "@/lib/image-processing";
import {
  CameraError,
  toCameraError,
  type CameraDevice,
  type CameraSource,
  type OpenedCamera,
} from "@/lib/camera/camera-source";

// 使える形式を探す。mp4 が録れればそれ（Safari など）、だめなら webm
function pickRecordingMimeType(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  for (const type of ["video/mp4", "video/webm"]) {
    try {
      if (MediaRecorder.isTypeSupported(type)) return type;
    } catch {
      // 判定できない形式は使わない
    }
  }
  return null;
}

// 映像を回して canvas に描き続け、その captureStream を返す。録画の中身を正しい向きにするため。
// canvas.captureStream が使えなければ null
function startRotatedStream(
  source: HTMLVideoElement,
  rotation: ImageRotation,
  fps: number,
): { stream: MediaStream; stop: () => void } | null {
  const vw = source.videoWidth;
  const vh = source.videoHeight;
  if (vw <= 0 || vh <= 0) return null;
  const canvas = document.createElement("canvas");
  if (typeof canvas.captureStream !== "function") return null;
  const size = rotatedSize({ width: vw, height: vh }, rotation);
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext("2d");
  if (!context) return null;
  let stopped = false;
  let frameRequest = 0;
  const draw = () => {
    if (stopped) return;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.translate(size.width / 2, size.height / 2);
    context.rotate((rotation * Math.PI) / 180); // 時計回り（写真の回転と同じ）
    context.drawImage(source, -vw / 2, -vh / 2, vw, vh);
    frameRequest = requestAnimationFrame(draw);
  };
  draw();
  const stream = canvas.captureStream(fps);
  return {
    stream,
    stop() {
      stopped = true;
      cancelAnimationFrame(frameRequest);
      for (const t of stream.getTracks()) t.stop();
      canvas.width = 0;
      canvas.height = 0;
    },
  };
}

function openedCamera(stream: MediaStream, track: MediaStreamTrack): OpenedCamera {
  // 10秒は許可を待つ時間を含まない。映像が届いた今から数える
  const gate = createReadyGate();
  let video: HTMLVideoElement | null = null;
  let stopped = false;
  const endedListeners = new Set<() => void>();
  let activeRecorder: MediaRecorder | null = null;

  const handleLoaded = () => gate.resolve();
  const handleTrackEnded = () => {
    for (const listener of [...endedListeners]) listener();
  };
  track.addEventListener("ended", handleTrackEnded);

  function detach() {
    if (!video) return;
    video.removeEventListener("loadeddata", handleLoaded);
    video.srcObject = null;
    video = null;
  }

  return {
    deviceId: track.getSettings().deviceId ?? "",
    attach(next) {
      if (stopped || next === video) return;
      detach();
      if (!next) return;
      video = next;
      next.addEventListener("loadeddata", handleLoaded);
      next.srcObject = stream;
      next.play().catch((error: unknown) => {
        // 付け替えで中断されただけなら失敗ではない
        if (error instanceof Error && error.name === "AbortError") return;
        gate.reject(new CameraError("failed"));
      });
    },
    ready: () => gate.promise,
    async capture() {
      const source = video;
      if (
        !source ||
        track.readyState !== "live" ||
        source.videoWidth <= 0 ||
        source.videoHeight <= 0 ||
        source.readyState < HTMLMediaElement.HAVE_CURRENT_DATA
      ) {
        throw new CameraError("failed");
      }
      const canvas = document.createElement("canvas");
      try {
        canvas.width = source.videoWidth;
        canvas.height = source.videoHeight;
        const context = canvas.getContext("2d");
        if (!context) throw new CameraError("failed");
        // 反転は表示（CSS）だけ。保存する写真はそのまま写す
        context.drawImage(source, 0, 0, canvas.width, canvas.height);
        return await new Promise<Blob>((resolve, reject) => {
          canvas.toBlob(
            (blob) => (blob ? resolve(blob) : reject(new CameraError("failed"))),
            "image/jpeg",
            0.98,
          );
        });
      } finally {
        canvas.width = 0;
        canvas.height = 0;
      }
    },
    canRecord: () => pickRecordingMimeType() !== null,
    record(seconds, signal, rotation = 0) {
      const picked = pickRecordingMimeType();
      if (stopped || !picked || track.readyState !== "live" || activeRecorder) {
        return Promise.reject(new CameraError("failed"));
      }
      if (signal?.aborted) return Promise.reject(new CameraError("failed"));
      const mimeType: string = picked;
      // 回して撮るときは、回した映像を録る。回せない環境では録らない（横倒しの動画を残さない）
      let rotated: { stream: MediaStream; stop: () => void } | null = null;
      if (recordingNeedsRotation(rotation)) {
        const fps = Math.round(track.getSettings().frameRate ?? 30) || 30;
        rotated = video ? startRotatedStream(video, rotation, fps) : null;
        if (!rotated) return Promise.reject(new CameraError("failed"));
      }
      const recordStream = rotated ? rotated.stream : stream;
      return new Promise<Blob>((resolve, reject) => {
        const chunks: Blob[] = [];
        let finished = false;
        let aborted = false;
        let recorder: MediaRecorder;
        try {
          recorder = new MediaRecorder(recordStream, { mimeType });
        } catch {
          rotated?.stop();
          reject(new CameraError("failed"));
          return;
        }
        activeRecorder = recorder;
        const timeout = setTimeout(stopRecorder, seconds * 1000);
        function stopRecorder() {
          clearTimeout(timeout);
          if (recorder.state !== "inactive") {
            try {
              recorder.stop();
            } catch {
              // すでに止まっている
            }
          }
        }
        function finish(error: CameraError | null) {
          if (finished) return;
          finished = true;
          clearTimeout(timeout);
          rotated?.stop();
          signal?.removeEventListener("abort", handleAbort);
          if (activeRecorder === recorder) activeRecorder = null;
          if (error || aborted || chunks.length === 0) {
            reject(error ?? new CameraError("failed"));
            return;
          }
          resolve(new Blob(chunks, { type: recorder.mimeType || mimeType }));
        }
        function handleAbort() {
          aborted = true;
          stopRecorder();
          finish(new CameraError("failed"));
        }
        recorder.ondataavailable = (event) => {
          if (event.data.size > 0) chunks.push(event.data);
        };
        recorder.onerror = () => finish(new CameraError("failed"));
        recorder.onstop = () => finish(null);
        signal?.addEventListener("abort", handleAbort);
        try {
          recorder.start(1000);
        } catch {
          finish(new CameraError("failed"));
        }
      });
    },
    onEnded(listener) {
      endedListeners.add(listener);
      return () => {
        endedListeners.delete(listener);
      };
    },
    stop() {
      stopped = true;
      track.removeEventListener("ended", handleTrackEnded);
      endedListeners.clear();
      if (activeRecorder && activeRecorder.state !== "inactive") {
        try {
          activeRecorder.stop();
        } catch {
          // すでに止まっている
        }
      }
      gate.reject(new CameraError("failed")); // 未決着の ready を決着させる
      detach();
      for (const t of stream.getTracks()) t.stop();
    },
  };
}

export function createBrowserCameraSource(): CameraSource {
  return {
    isSupported() {
      return (
        typeof window !== "undefined" &&
        window.isSecureContext &&
        typeof navigator !== "undefined" &&
        !!navigator.mediaDevices?.getUserMedia
      );
    },
    async open(deviceId) {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            deviceId: deviceId ? { exact: deviceId } : undefined,
            width: { ideal: 3840 },
            height: { ideal: 2160 },
          },
        });
      } catch (error) {
        throw toCameraError(error);
      }
      const track = stream.getVideoTracks()[0];
      if (!track) {
        for (const t of stream.getTracks()) t.stop();
        throw new CameraError("failed");
      }
      return openedCamera(stream, track);
    },
    async listDevices() {
      const all = await navigator.mediaDevices.enumerateDevices();
      return all
        .filter((device) => device.kind === "videoinput")
        .map(
          (device, index): CameraDevice => ({
            deviceId: device.deviceId,
            label: device.label || `カメラ ${index + 1}`,
          }),
        );
    },
    onDevicesChanged(listener) {
      const devices = navigator.mediaDevices;
      devices.addEventListener("devicechange", listener);
      return () => devices.removeEventListener("devicechange", listener);
    },
  };
}
