// 端末の写真を複数選んだとき、選んだ列（動画のコマと同じ列）に何枚入れるかを決める（純粋な関数）。
// 列の上限は動画のコマと同じ MAX_PICKED_FRAMES（6枚）。あふれた分は足さずに、一言で知らせる。
import { MAX_PICKED_FRAMES, type PickedFrame } from "@/lib/outfits/clip-frames";

// 今の列にあと何枚入るか
export function photoRoom(currentCount: number): number {
  return Math.max(0, MAX_PICKED_FRAMES - currentCount);
}

// 選ばれた枚数のうち、処理して足すのは先頭から何枚か（残りは無視する）
export function planPhotoSelection(
  currentCount: number,
  pickedCount: number,
): { take: number; ignored: number } {
  const take = Math.min(photoRoom(currentCount), Math.max(0, pickedCount));
  return { take, ignored: Math.max(0, pickedCount) - take };
}

// 処理できた写真を、今の列の後ろに足す（並びは選んだ順。上限を超える分は足さない）。
// 写真に撮影の時刻は無いので、timeSec は 0 にする（動画のコマの重複判定には使わない）
export function mergePickedPhotos<T>(
  list: PickedFrame<T>[],
  photos: { id: string; image: T }[],
): { list: PickedFrame<T>[]; added: number } {
  const room = photoRoom(list.length);
  const taken = photos.slice(0, room);
  return {
    list: [...list, ...taken.map((p) => ({ id: p.id, timeSec: 0, image: p.image }))],
    added: taken.length,
  };
}

// 画面に出す一言（問題がなければ null）
export function photoSelectionNotice(input: { ignored: number; failed: number }): string | null {
  const parts: string[] = [];
  if (input.ignored > 0) parts.push(`選べるのは${MAX_PICKED_FRAMES}枚までです。${input.ignored}枚は追加しませんでした`);
  if (input.failed > 0) parts.push(`${input.failed}枚は開けませんでした`);
  return parts.length > 0 ? parts.join("。") : null;
}
