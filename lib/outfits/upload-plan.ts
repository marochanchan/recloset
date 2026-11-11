// 確定のときに送るものの順番（純粋な関数）。
// 最初の写真が下書きを作る。残りの写真、最後に動画。動画が失敗しても写真と記録は止めないので、動画は最後。
import { MAX_PICKED_FRAMES } from "@/lib/outfits/clip-frames";

export type MediaUploadStep = {
  kind: "photo" | "video";
  photoIndex: number | null; // 写真のときだけ（選んだ列の何番目か）
  sortOrder: number;
  createsDraft: boolean;
};

export function planMediaUploads(input: { photoCount: number; keepVideo: boolean }): MediaUploadStep[] {
  const { photoCount, keepVideo } = input;
  if (!Number.isInteger(photoCount) || photoCount < 0 || photoCount > MAX_PICKED_FRAMES) {
    throw new Error("invalid photoCount");
  }
  // 写真が0枚のコーデは作らない（動画だけでも作らない）
  if (photoCount === 0) return [];
  const steps: MediaUploadStep[] = [];
  for (let i = 0; i < photoCount; i++) {
    steps.push({ kind: "photo", photoIndex: i, sortOrder: i, createsDraft: i === 0 });
  }
  if (keepVideo) steps.push({ kind: "video", photoIndex: null, sortOrder: photoCount, createsDraft: false });
  return steps;
}
