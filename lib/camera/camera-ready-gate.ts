// 「最初のフレームが届いた」を待つ門。一度だけ決着し、タイマーは必ず片付ける。

import { CameraError } from "@/lib/camera/camera-source";

export const CAMERA_READY_TIMEOUT_MS = 10_000;

export function createReadyGate(timeoutMs: number = CAMERA_READY_TIMEOUT_MS): {
  promise: Promise<void>;
  resolve(): void;
  reject(error: CameraError): void;
} {
  let settled = false;
  let resolvePromise: () => void = () => {};
  let rejectPromise: (error: CameraError) => void = () => {};

  const promise = new Promise<void>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  // 待つ人がいなくても未処理の reject にしない（待つ人には元の reject が届く）
  promise.catch(() => {});

  const settle = (action: () => void) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    action();
  };

  const timer = setTimeout(() => {
    settle(() => rejectPromise(new CameraError("failed")));
  }, timeoutMs);

  return {
    promise,
    resolve: () => settle(resolvePromise),
    reject: (error) => settle(() => rejectPromise(error)),
  };
}
