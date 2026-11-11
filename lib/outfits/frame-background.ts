// 選んだコマの背景（そのまま／ぼかす／白）の純粋な部分。
// AI（MediaPipe）と canvas を使う部分は lib/outfits/frame-background-browser.ts（ブラウザ専用）。

export type BackgroundMode = "none" | "blur" | "white";

export const BACKGROUND_MODES: readonly BackgroundMode[] = ["none", "blur", "white"];

export function isBackgroundMode(value: unknown): value is BackgroundMode {
  return value === "none" || value === "blur" || value === "white";
}

/** selfie_multiclass_256x256 の背景のクラス番号（0=背景、1=髪、2=体の肌、3=顔の肌、4=服、5=その他） */
export const BACKGROUND_CLASS_INDEX = 0;

/**
 * カテゴリのマスク（クラス番号の列）から「人らしさ」のアルファ（0〜255）を作る。
 * 背景のクラス以外はすべて人とみなす（255）。
 */
export function personAlphaFromCategories(
  categories: ArrayLike<number>,
  backgroundIndex: number = BACKGROUND_CLASS_INDEX,
): Uint8ClampedArray {
  const alpha = new Uint8ClampedArray(categories.length);
  for (let i = 0; i < categories.length; i++) {
    alpha[i] = categories[i] === backgroundIndex ? 0 : 255;
  }
  return alpha;
}

/** 0〜1 に収めたうえでなめらかに 0→1 へつなぐ（edge0 以下は 0、edge1 以上は 1） */
function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * 「背景の信頼度」（0〜1）から「人らしさ」のアルファ（0〜255）を作る。
 * 人らしさ = 1 - 背景の信頼度。低い所は背景、高い所は人にはっきり寄せて、
 * 間だけをなめらかにつなぐ（縁がにじみすぎないように）。
 */
export function personAlphaFromBackgroundConfidence(
  background: ArrayLike<number>,
  low = 0.25,
  high = 0.75,
): Uint8ClampedArray {
  const alpha = new Uint8ClampedArray(background.length);
  for (let i = 0; i < background.length; i++) {
    const person = 1 - background[i];
    alpha[i] = Math.round(smoothstep(low, high, person) * 255);
  }
  return alpha;
}

/** 「白」の背景の色。アプリの写真の枠（bg-photo）に近い色にはせず、純白にする（白背景の写真として自然なため） */
export const WHITE_BACKGROUND_COLOR = "#ffffff";

// ---- 処理済みの画像の状態 ----

export type ProcessedEntry<T> = { mode: BackgroundMode; image: T };
/** コマの id → 処理済みの画像（どの設定で作ったかを持つ） */
export type ProcessedMap<T> = Record<string, ProcessedEntry<T>>;

/**
 * 設定・コマの列が変わったときの整理。
 * - 設定が「そのまま」なら処理済みは全部捨てる（pending もなし）。
 * - 今の設定で作ってあって、まだ残っているコマの処理済みだけ残す（選び直し・削除で消えたコマ、別の設定のものは捨てる）。
 * - 残りのコマは作る必要がある（pending）。
 */
export function reconcileProcessed<T>(
  processed: ProcessedMap<T>,
  frameIds: readonly string[],
  mode: BackgroundMode,
): { keep: ProcessedMap<T>; pending: string[] } {
  if (mode === "none") return { keep: {}, pending: [] };
  const keep: ProcessedMap<T> = {};
  const pending: string[] = [];
  for (const id of frameIds) {
    const entry = processed[id];
    if (entry && entry.mode === mode) keep[id] = entry;
    else pending.push(id);
  }
  return { keep, pending };
}

/**
 * 送る写真を決める。「そのまま」なら元の画像。
 * ぼかす／白なら、今の設定で作ってある処理済みだけを返す（まだなら null。元の写真は返さない）。
 */
export function resolveSendImage<T>(
  frameId: string,
  original: T,
  processed: ProcessedMap<T>,
  mode: BackgroundMode,
): T | null {
  if (mode === "none") return original;
  const entry = processed[frameId];
  return entry && entry.mode === mode ? entry.image : null;
}

/**
 * 分割の結果から値を読み取り、読み取りの成否によらず結果（全部のマスク）を解放する。
 * 解放の失敗は握りつぶす（読み取りの結果や元のエラーを隠さないため）。
 */
export function readThenClose<R extends { close(): void }, T>(result: R, read: (result: R) => T): T {
  try {
    return read(result);
  } finally {
    try {
      result.close();
    } catch {
      // 後始末の失敗は無視する
    }
  }
}
