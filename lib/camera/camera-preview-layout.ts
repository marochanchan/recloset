// プレビューの見た目の計算。映像は鏡のように左右反転して表示する。

import type { ImageRotation } from "@/lib/image-processing";

export type PreviewLayout = {
  aspect: number; // 回転後の 幅/高さ
  widthPercent: number; // video の幅（外枠の幅に対する%）
  heightPercent: number; // video の高さ（外枠の高さに対する%）
  transform: string;
};

export function previewLayout(
  frame: { width: number; height: number },
  rotation: ImageRotation,
): PreviewLayout {
  const sideways = rotation === 90 || rotation === 270;
  // 横向きのときは、回した映像が外枠に収まるよう幅と高さを入れ替えて割合を出す
  const aspect = sideways ? frame.height / frame.width : frame.width / frame.height;
  const widthPercent = sideways ? (frame.width / frame.height) * 100 : 100;
  const heightPercent = sideways ? (frame.height / frame.width) * 100 : 100;
  // CSS は右から順に効く：先に回してから左右反転（時計回りは processImage と同じ）
  const turn = rotation === 0 ? "" : ` rotate(${rotation}deg)`;
  return {
    aspect,
    widthPercent,
    heightPercent,
    transform: `translate(-50%, -50%) scaleX(-1)${turn}`,
  };
}
