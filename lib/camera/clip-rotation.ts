// 回して撮った動画の寸法（純粋な関数）。
// 90度・270度のときは、幅と高さが入れ替わる。動画は録るときに回して保存するので、
// 録ったあとの動画に回転をもう一度かけてはいけない（コマ選びの向きは 0 にする）。
import type { ImageRotation } from "@/lib/image-processing";

export function rotatedSize(
  size: { width: number; height: number },
  rotation: ImageRotation,
): { width: number; height: number } {
  return rotation === 90 || rotation === 270
    ? { width: size.height, height: size.width }
    : { width: size.width, height: size.height };
}

// 録画のときに、映像そのものを回すか（0度ならカメラの映像をそのまま録る）
export function recordingNeedsRotation(rotation: ImageRotation): boolean {
  return rotation !== 0;
}

// 録画のときに回した動画から取るコマ・再生の向き。すでに正しい向きなので常に 0
export const ROTATION_AFTER_RECORDING: ImageRotation = 0;
