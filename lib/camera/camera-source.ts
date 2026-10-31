// カメラの型とエラーの扱い。ブラウザの実装（getUserMedia）は別ファイルで差し替える。

export type CameraDevice = { deviceId: string; label: string };

export type CameraErrorReason =
  | "unsupported"
  | "permission_denied"
  | "not_found"
  | "in_use"
  | "disconnected"
  | "failed";

export class CameraError extends Error {
  reason: CameraErrorReason;

  constructor(reason: CameraErrorReason) {
    super(reason);
    this.name = "CameraError";
    this.reason = reason;
  }
}

// ブラウザの例外を、画面に出せる理由に直す。分からないものは failed。
export function toCameraError(error: unknown): CameraError {
  if (error instanceof CameraError) return error;
  const name = error instanceof Error ? error.name : "";
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return new CameraError("permission_denied");
    case "NotFoundError":
    case "OverconstrainedError":
      return new CameraError("not_found");
    case "NotReadableError":
    case "AbortError":
      return new CameraError("in_use");
    default:
      return new CameraError("failed");
  }
}

const MESSAGES: Record<CameraErrorReason, string> = {
  unsupported: "このブラウザではカメラを使えません。写真を選んで記録できます",
  permission_denied:
    "カメラの使用が許可されていません。ブラウザの設定で許可するか、写真を選んで記録できます",
  not_found: "カメラが見つかりませんでした。つなぎ直すか、写真を選んで記録できます",
  in_use: "カメラがほかのアプリで使われているようです。閉じてから、もう一度お試しください",
  disconnected: "カメラとのつながりが切れました。つなぎ直して、もう一度お試しください",
  failed: "カメラを開けませんでした。時間をおいて、もう一度お試しください",
};

export function cameraErrorMessage(reason: CameraErrorReason): string {
  return MESSAGES[reason];
}

export interface OpenedCamera {
  deviceId: string; // 実際に開いたカメラ
  attach(video: HTMLVideoElement | null): void;
  ready(): Promise<void>; // 最初のフレームが届くと解決。再生できなければ CameraError で reject
  capture(): Promise<Blob>; // 反転も回転もしていない生のフレーム
  onEnded(listener: () => void): () => void;
  stop(): void;
}

export interface CameraSource {
  isSupported(): boolean;
  open(deviceId: string | null): Promise<OpenedCamera>; // null は既定のカメラ
  listDevices(): Promise<CameraDevice[]>;
  onDevicesChanged(listener: () => void): () => void;
}
