// ============================================================
// 服画像の前処理（ブラウザ専用。canvasを使うためServer Componentからは呼ばない）
//
// - 端末の写真の向き（EXIF Orientation）を反映して読み込む
// - ユーザーが選んだ90°単位の回転を反映する
// - 長辺を縮小し、JPEGとして再エンコードする
//   （canvasで描き直すため、EXIF・GPS・XMP・iPhoneのHDRゲインマップ等は残らない）
// - 元のファイル（端末上の写真）は読み込むだけで変更しない
//
// ブラウザ差異について:
// - EXIFの向きは createImageBitmap(file, { imageOrientation: "from-image" }) で
//   反映する。現行のChrome / Edge / Firefox / Safariは対応しているが、
//   古いiOS Safari等でこのオプションを解釈しない場合は向きが反映されない
//   可能性がある。その場合もユーザーが「回転」で直せる。
// - createImageBitmapが使えない・失敗した場合は <img> での読み込みに
//   切り替える（現行ブラウザは <img> の描画でもEXIFの向きを反映する）。
// - HEICは、ブラウザ自体がデコードできる場合（主にSafari）だけ処理できる。
//   読み込めない場合は ImageProcessingError を投げる。
// ============================================================

export type ImageRotation = 0 | 90 | 180 | 270;

type ImageOutputOptions = {
  /** 長辺の最大px（元画像の方が小さい場合は拡大しない） */
  maxLongEdge: number;
  /** JPEGの品質（0〜1） */
  quality: number;
};

/** Storageへ保存する画像（拡大表示にも耐える解像度） */
export const UPLOAD_IMAGE_OPTIONS: ImageOutputOptions = {
  maxLongEdge: 1600,
  quality: 0.85,
};

/** 画像AI解析に送る画像（Server Actionの1MB上限に収まる大きさ） */
export const ANALYSIS_IMAGE_OPTIONS: ImageOutputOptions = {
  maxLongEdge: 1024,
  quality: 0.8,
};

/** 読み込む元画像の上限。保存されるのは縮小後の画像なので、Storageの10MBより大きくてよい */
export const MAX_SOURCE_IMAGE_BYTES = 30 * 1024 * 1024;

export type ProcessedImage = {
  blob: Blob;
  width: number;
  height: number;
};

/** ユーザーに表示してよいメッセージを持つエラー */
export class ImageProcessingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImageProcessingError";
  }
}

export function getNextRotation(rotation: ImageRotation): ImageRotation {
  return ((rotation + 90) % 360) as ImageRotation;
}

type DecodedImage = {
  source: CanvasImageSource;
  width: number;
  height: number;
  release: () => void;
};

const UNREADABLE_IMAGE_MESSAGE =
  "この画像は読み込めませんでした。JPEG・PNG・WebPの画像を選んでください（HEICの場合は、JPEGに変換してから選んでください）";

async function decodeWithImageElement(file: Blob): Promise<DecodedImage> {
  const url = URL.createObjectURL(file);
  const image = new Image();
  image.decoding = "async";
  image.src = url;
  try {
    await image.decode();
  } catch {
    URL.revokeObjectURL(url);
    throw new ImageProcessingError(UNREADABLE_IMAGE_MESSAGE);
  }
  return {
    source: image,
    width: image.naturalWidth,
    height: image.naturalHeight,
    release: () => URL.revokeObjectURL(url),
  };
}

// EXIFの向きを反映した状態で画像を読み込む
async function decodeImage(file: Blob): Promise<DecodedImage> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file, {
        imageOrientation: "from-image",
      });
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        release: () => bitmap.close(),
      };
    } catch {
      // 一部ブラウザ・形式で失敗した場合は <img> で読み直す
    }
  }
  return decodeWithImageElement(file);
}

function canvasToJpeg(
  canvas: HTMLCanvasElement,
  quality: number,
): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob(resolve, "image/jpeg", quality);
  });
}

/**
 * 画像を「向き補正 → 回転 → 長辺縮小 → JPEG再エンコード」した新しい画像を返す。
 * 透過部分（PNG・WebP）は白で塗りつぶす（JPEGは透過を持てないため）。
 */
export async function processImage(
  file: Blob,
  rotation: ImageRotation,
  options: ImageOutputOptions,
): Promise<ProcessedImage> {
  if (file.size > MAX_SOURCE_IMAGE_BYTES) {
    throw new ImageProcessingError(
      "画像が大きすぎます（30MBまで）。別の画像を選んでください",
    );
  }

  const decoded = await decodeImage(file);
  try {
    if (decoded.width === 0 || decoded.height === 0) {
      throw new ImageProcessingError(UNREADABLE_IMAGE_MESSAGE);
    }

    const scale = Math.min(
      1,
      options.maxLongEdge / Math.max(decoded.width, decoded.height),
    );
    const drawWidth = Math.max(1, Math.round(decoded.width * scale));
    const drawHeight = Math.max(1, Math.round(decoded.height * scale));
    const isQuarterTurn = rotation === 90 || rotation === 270;

    const canvas = document.createElement("canvas");
    canvas.width = isQuarterTurn ? drawHeight : drawWidth;
    canvas.height = isQuarterTurn ? drawWidth : drawHeight;

    const context = canvas.getContext("2d");
    if (!context) {
      throw new ImageProcessingError(
        "画像を処理できませんでした。時間をおいてお試しください",
      );
    }

    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    // キャンバスの中心を軸に回転してから、画像を中心に合わせて描く
    context.translate(canvas.width / 2, canvas.height / 2);
    context.rotate((rotation * Math.PI) / 180);
    context.drawImage(
      decoded.source,
      -drawWidth / 2,
      -drawHeight / 2,
      drawWidth,
      drawHeight,
    );

    const blob = await canvasToJpeg(canvas, options.quality);
    const result = { width: canvas.width, height: canvas.height };
    // iOS Safariはcanvasのメモリ上限が厳しいため、使い終わったらすぐ解放する
    canvas.width = 0;
    canvas.height = 0;

    if (!blob) {
      throw new ImageProcessingError(
        "画像を処理できませんでした。時間をおいてお試しください",
      );
    }
    return { blob, ...result };
  } finally {
    decoded.release();
  }
}

/** Storageへ保存する画像（長辺1600px・JPEG品質0.85） */
export function processImageForUpload(
  file: Blob,
  rotation: ImageRotation,
): Promise<ProcessedImage> {
  return processImage(file, rotation, UPLOAD_IMAGE_OPTIONS);
}

/** 画像AI解析に送る画像（長辺1024px・JPEG品質0.8） */
export function processImageForAnalysis(
  file: Blob,
  rotation: ImageRotation,
): Promise<ProcessedImage> {
  return processImage(file, rotation, ANALYSIS_IMAGE_OPTIONS);
}
