// 送る前の写真（確認中）の向きの状態。画像の処理そのものは lib/image-processing.ts。
// 回すたびに、元の写真から向きを変えて作り直す（縮小済みの写真を重ねて回すと画質が落ちるため）。
import { getNextRotation, type ImageRotation } from "@/lib/image-processing";

export type StagedPhoto<S> = { source: S; rotation: ImageRotation };

export function stagePhoto<S>(source: S): StagedPhoto<S> {
  return { source, rotation: 0 };
}

/** 90度ずつ時計回り。カメラの「向きを回す」と同じ順（getNextRotation）。 */
export function rotateStaged<S>(staged: StagedPhoto<S>): StagedPhoto<S> {
  return { source: staged.source, rotation: getNextRotation(staged.rotation) };
}
