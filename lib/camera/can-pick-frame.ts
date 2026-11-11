// 動画からコマを切り出してよいか。メタデータだけで絵がまだ無いとき・シーク中は不可。

// HTMLMediaElement.HAVE_CURRENT_DATA（Node では使えないので数値で持つ）
export const HAVE_CURRENT_DATA = 2;

export function canPickFrame(input: {
  readyState: number;
  seeking: boolean;
  hasSeekedOnce: boolean; // 最初の位置への移動が済んだ
}): boolean {
  return input.hasSeekedOnce && !input.seeking && input.readyState >= HAVE_CURRENT_DATA;
}
