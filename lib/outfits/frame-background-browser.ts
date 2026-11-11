// ============================================================
// 選んだコマの背景を「ぼかす」「白」にする（ブラウザ専用。canvas と MediaPipe を使う）
//
// - AI（人と背景を分けるモデル）はブラウザの中で動かす。写真は外に出さない
// - モデル（selfie_multiclass_256x256、Apache 2.0）と wasm は自分のサイトから配る
//   （public/mediapipe/。出典は public/mediapipe/README.md）
// - 読み込みは、初めて「ぼかす」「白」を選んだときだけ（動的 import）
// - 単体テストはしない（純粋な部分は frame-background.ts）
// ============================================================

import type { ImageSegmenter } from "@mediapipe/tasks-vision";
import {
  WHITE_BACKGROUND_COLOR,
  personAlphaFromBackgroundConfidence,
  type BackgroundMode,
} from "@/lib/outfits/frame-background";
import {
  ImageProcessingError,
  OUTFIT_UPLOAD_IMAGE_OPTIONS,
  type ProcessedImage,
} from "@/lib/image-processing";

const WASM_BASE_PATH = "/mediapipe/wasm";
const MODEL_PATH = "/mediapipe/models/selfie_multiclass_256x256.tflite";
// 背景のクラス（0）の信頼度を使う。人らしさ = 1 - 背景
const BACKGROUND_MASK_INDEX = 0;
// 縁の羽（マスクを広げたあとにぼかす幅。写真の長辺に対する割合、最低 2px）
const FEATHER_RATIO = 0.003;
// 「ぼかす」の強さ：長辺をこの値まで縮めてから広げる（小さいほど強くぼける）
const BLUR_LONG_EDGE = 72;

export const BACKGROUND_FAILED_MESSAGE =
  "背景を整えられませんでした。「そのまま」に戻しました";

let segmenterPromise: Promise<ImageSegmenter> | null = null;

async function createSegmenter(): Promise<ImageSegmenter> {
  const { FilesetResolver, ImageSegmenter } = await import("@mediapipe/tasks-vision");
  const fileset = await FilesetResolver.forVisionTasks(WASM_BASE_PATH);
  const create = (delegate: "GPU" | "CPU") =>
    ImageSegmenter.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_PATH, delegate },
      runningMode: "IMAGE",
      outputConfidenceMasks: true,
      outputCategoryMask: false,
    });
  try {
    return await create("GPU");
  } catch {
    // WebGL が使えない端末は CPU（wasm）で動かす
    return create("CPU");
  }
}

/** 初めて呼んだときだけ読み込む。失敗したら次に呼んだときもう一度試す */
function getSegmenter(): Promise<ImageSegmenter> {
  if (!segmenterPromise) {
    segmenterPromise = createSegmenter().catch((error) => {
      segmenterPromise = null;
      throw error;
    });
  }
  return segmenterPromise;
}

/** 描画を進めさせる（1枚ごとに画面へ返す） */
function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function makeCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function releaseCanvas(canvas: HTMLCanvasElement) {
  // iOS Safari の canvas メモリ上限対策（image-processing.ts と同じ）
  canvas.width = 0;
  canvas.height = 0;
}

/** 背景を縮小→拡大でぼかした絵を ctx に描く（ctx.filter が使えない Safari でも動く） */
function drawBlurred(
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  width: number,
  height: number,
) {
  const scale = Math.min(1, BLUR_LONG_EDGE / Math.max(width, height));
  const small = makeCanvas(Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale)));
  const smallCtx = small.getContext("2d");
  if (!smallCtx) throw new ImageProcessingError(BACKGROUND_FAILED_MESSAGE);
  smallCtx.imageSmoothingEnabled = true;
  smallCtx.imageSmoothingQuality = "high";
  smallCtx.drawImage(source, 0, 0, small.width, small.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  // 縁が透けないよう、少し大きめに描く
  const pad = Math.ceil(Math.max(width, height) * 0.02);
  ctx.drawImage(small, -pad, -pad, width + pad * 2, height + pad * 2);
  releaseCanvas(small);
}

/**
 * 写真の背景を処理して、新しい写真（長辺 2560px 以下・JPEG・品質 0.9）を返す。
 * mode は "blur" か "white"。失敗したら ImageProcessingError を投げる。
 */
export async function applyBackgroundToImage(
  image: ProcessedImage,
  mode: Exclude<BackgroundMode, "none">,
): Promise<ProcessedImage> {
  await yieldToBrowser();
  let segmenter: ImageSegmenter;
  try {
    segmenter = await getSegmenter();
  } catch {
    throw new ImageProcessingError(BACKGROUND_FAILED_MESSAGE);
  }

  let bitmap: ImageBitmap | null = null;
  const canvases: HTMLCanvasElement[] = [];
  const track = (width: number, height: number) => {
    const canvas = makeCanvas(width, height);
    canvases.push(canvas);
    return canvas;
  };
  try {
    bitmap = await createImageBitmap(image.blob);
    const width = bitmap.width;
    const height = bitmap.height;
    await yieldToBrowser();

    // 1. 人と背景を分ける（マスクは低い解像度で出る）
    const result = segmenter.segment(bitmap);
    const bgMask = result.confidenceMasks?.[BACKGROUND_MASK_INDEX];
    if (!bgMask) throw new Error("no_mask");
    const maskWidth = bgMask.width;
    const maskHeight = bgMask.height;
    const alpha = personAlphaFromBackgroundConfidence(bgMask.getAsFloat32Array());
    try {
      result.confidenceMasks?.forEach((m) => m.close());
    } catch {
      // 後始末の失敗は無視する
    }
    await yieldToBrowser();

    // 2. アルファをマスクの絵にして、写真の大きさに広げる（縁は少しぼかす）
    const maskSmall = track(maskWidth, maskHeight);
    const maskSmallCtx = maskSmall.getContext("2d");
    if (!maskSmallCtx) throw new Error("no_context");
    const maskData = maskSmallCtx.createImageData(maskWidth, maskHeight);
    for (let i = 0; i < alpha.length; i++) maskData.data[i * 4 + 3] = alpha[i];
    maskSmallCtx.putImageData(maskData, 0, 0);

    const personLayer = track(width, height);
    const personCtx = personLayer.getContext("2d");
    if (!personCtx) throw new Error("no_context");
    // まず写真を描き、マスクで「人の所だけ」残す
    personCtx.drawImage(bitmap, 0, 0, width, height);
    personCtx.globalCompositeOperation = "destination-in";
    personCtx.imageSmoothingEnabled = true;
    personCtx.imageSmoothingQuality = "high";
    const feather = Math.max(2, Math.round(Math.max(width, height) * FEATHER_RATIO));
    // ctx.filter が使えない環境では、拡大の補間だけの柔らかさになる
    if ("filter" in personCtx) personCtx.filter = `blur(${feather}px)`;
    personCtx.drawImage(maskSmall, 0, 0, width, height);
    personCtx.filter = "none";
    personCtx.globalCompositeOperation = "source-over";

    // 3. 背景を作って、人を重ねる
    const output = track(width, height);
    const outCtx = output.getContext("2d");
    if (!outCtx) throw new Error("no_context");
    if (mode === "white") {
      outCtx.fillStyle = WHITE_BACKGROUND_COLOR;
      outCtx.fillRect(0, 0, width, height);
    } else {
      outCtx.fillStyle = WHITE_BACKGROUND_COLOR;
      outCtx.fillRect(0, 0, width, height);
      drawBlurred(outCtx, bitmap, width, height);
    }
    outCtx.drawImage(personLayer, 0, 0, width, height);
    await yieldToBrowser();

    // 4. JPEG（今の写真と同じ品質）
    const blob = await new Promise<Blob | null>((resolve) => {
      output.toBlob(resolve, "image/jpeg", OUTFIT_UPLOAD_IMAGE_OPTIONS.quality);
    });
    if (!blob) throw new Error("no_blob");
    return { blob, width, height };
  } catch (error) {
    if (error instanceof ImageProcessingError) throw error;
    throw new ImageProcessingError(BACKGROUND_FAILED_MESSAGE);
  } finally {
    bitmap?.close();
    canvases.forEach(releaseCanvas);
  }
}
