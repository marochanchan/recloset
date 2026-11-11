// 動画から選んだコマの列（純粋な関数）。並びは追加した順（先頭が代表の写真になる）。

export const MAX_PICKED_FRAMES = 6;
// 同じ時刻とみなす幅（秒）。スライダーの刻み（0.05秒）と同じ
export const SAME_TIME_SECONDS = 0.05;

export type PickedFrame<T> = { id: string; timeSec: number; image: T };

export function addPickedFrame<T>(
  list: PickedFrame<T>[],
  frame: PickedFrame<T>,
): { list: PickedFrame<T>[]; result: "added" | "duplicate" | "full" } {
  if (list.length >= MAX_PICKED_FRAMES) return { list, result: "full" };
  // 浮動小数点の誤差で境界がぶれないよう、ミリ秒に丸めて比べる
  const near = list.some(
    (f) => Math.round(Math.abs(f.timeSec - frame.timeSec) * 1000) <= SAME_TIME_SECONDS * 1000,
  );
  if (near) return { list, result: "duplicate" };
  return { list: [...list, frame], result: "added" };
}

export function removePickedFrame<T>(list: PickedFrame<T>[], id: string): PickedFrame<T>[] {
  return list.filter((f) => f.id !== id);
}
