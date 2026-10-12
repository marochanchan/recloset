import { CLOTHING_IMAGE_BUCKET } from "@/lib/clothing-drafts";
import { PHOTO_ONLY_CATEGORY, PHOTO_ONLY_TITLE } from "@/lib/clothing-options";
import {
  ImageProcessingError,
  processImageForUpload,
  type ProcessedImage,
} from "@/lib/image-processing";
import type { SupabaseClient } from "@supabase/supabase-js";

// ============================================================
// 写真からまとめて登録（写真1枚＝1着）の保存処理と画像変換の制御
//
// 写真1枚ごとに、選んだ時点で決めた服ID・画像パス（PhotoItemTarget）を使い、
// 既存の登録フォームと同じ順で保存する:
//   1. clothing_items を作成（タイトル「写真から登録した服」、カテゴリー other）
//   2. Storage へ画像をアップロード
//   3. clothing_images を作成（sort_order 0）
//
// 再試行の安全性:
// - 同じ写真は常に同じID・パスで保存するため、再試行しても2着目はできない
// - 「既にある」（23505・Storageの重複）や、通信の失敗で結果が分からない場合は、
//   DB・Storageを確認し、本人の期待どおりのデータがあるときだけ続ける
//   （服は本人の行か、画像の行はこの服にこのパスで紐づいているか）
// - この関数は保存済みのデータを削除しない。途中で失敗した服は、
//   同じ target で再試行すると続きから保存される。登録をやめる場合だけ
//   discardIncompletePhotoItem で、画像の紐づいていない服を片付ける
// - AIは呼ばない
// ============================================================

/** 一度にまとめて登録できる写真の枚数 */
export const MAX_PHOTO_BATCH_SIZE = 20;
/** 同時に変換する写真の枚数（スマホのメモリ上限を考慮） */
export const PHOTO_PROCESSING_CONCURRENCY = 2;
/** Storage の上限（migration 003 のバケット設定と同じ） */
export const MAX_PHOTO_UPLOAD_BYTES = 10 * 1024 * 1024;

const UUID_PATTERN = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/** 写真1枚の保存先（選んだ時点で決め、再試行でも変えない） */
export type PhotoItemTarget = {
  itemId: string;
  imagePath: string;
};

export function createPhotoItemTarget(
  userId: string,
  randomUUID: () => string = () => crypto.randomUUID(),
): PhotoItemTarget {
  const itemId = randomUUID();
  return { itemId, imagePath: `${userId}/${itemId}/${randomUUID()}.jpg` };
}

/** target が「本人のフォルダ／この服のフォルダ／UUID.jpg」の形か（他人のパスを使わない） */
export function isPhotoItemTargetForUser(target: PhotoItemTarget, userId: string): boolean {
  const itemPattern = new RegExp(`^${UUID_PATTERN}$`);
  const pathPattern = new RegExp(`^${UUID_PATTERN}/${UUID_PATTERN}/${UUID_PATTERN}\\.jpg$`);
  return (
    itemPattern.test(target.itemId) &&
    pathPattern.test(target.imagePath) &&
    target.imagePath.startsWith(`${userId}/${target.itemId}/`)
  );
}

export type PhotoItemStage = "item" | "upload" | "image";

export type RegisterPhotoItemResult =
  | {
      ok: true;
      /** 前回の試行で保存済みだった段階があったか（再試行で続きから保存した） */
      resumed: boolean;
    }
  | {
      ok: false;
      stage: PhotoItemStage;
      /** 同じ target で再試行すれば成功しうるか（通信の失敗・結果不明など） */
      retryable: boolean;
      reason: "unknown" | "denied" | "invalid" | "conflict";
      error?: unknown;
    };

type ErrorLike = { code?: unknown; message?: unknown; status?: unknown; statusCode?: unknown };

function errorCode(error: unknown): string {
  const code = (error as ErrorLike | null)?.code;
  return typeof code === "string" ? code : "";
}

// PostgreSQLのエラー（5桁のSQLSTATE）は、DBが処理して拒否した確定の失敗。
// コードのないエラー（通信の失敗など）は、保存されたかどうかが分からない
function isDefiniteDbError(error: unknown): boolean {
  return /^[0-9A-Z]{5}$/.test(errorCode(error));
}

function failureReason(error: unknown): "denied" | "invalid" | "unknown" {
  const code = errorCode(error);
  if (code === "42501") return "denied";
  if (isDefiniteDbError(error)) return "invalid";
  return "unknown";
}

function isStorageDuplicate(error: unknown): boolean {
  const e = error as ErrorLike | null;
  return (
    e?.statusCode === "409" ||
    e?.status === 409 ||
    e?.code === "ResourceAlreadyExists" ||
    (typeof e?.message === "string" && /already exists/i.test(e.message))
  );
}

// アップロードの失敗のうち、再試行しても成功しないもの（権限・容量・形式）
function isDefiniteStorageRejection(error: unknown): boolean {
  const e = error as ErrorLike | null;
  const statusCode = typeof e?.statusCode === "string" ? e.statusCode : "";
  return ["403", "413", "415"].includes(statusCode) || e?.status === 403 || e?.status === 413;
}

/** 本人の服の行があるか（RLSにより本人の行しか見えない） */
async function findOwnItem(
  supabase: SupabaseClient,
  userId: string,
  itemId: string,
): Promise<{ ok: true; exists: boolean } | { ok: false; error: unknown }> {
  try {
    const { data, error } = await supabase
      .from("clothing_items")
      .select("id, user_id")
      .eq("id", itemId)
      .maybeSingle();
    if (error) return { ok: false, error };
    return { ok: true, exists: !!data && data.user_id === userId };
  } catch (error) {
    return { ok: false, error };
  }
}

/** この服に紐づく画像の行のパス */
async function listItemImagePaths(
  supabase: SupabaseClient,
  itemId: string,
): Promise<{ ok: true; paths: string[] } | { ok: false; error: unknown }> {
  try {
    const { data, error } = await supabase
      .from("clothing_images")
      .select("image_path")
      .eq("clothing_item_id", itemId);
    if (error) return { ok: false, error };
    return { ok: true, paths: (data ?? []).map((row) => row.image_path as string) };
  } catch (error) {
    return { ok: false, error };
  }
}

async function storageObjectExists(
  supabase: SupabaseClient,
  path: string,
): Promise<{ ok: true; exists: boolean } | { ok: false; error: unknown }> {
  try {
    const { data } = await supabase.storage.from(CLOTHING_IMAGE_BUCKET).exists(path);
    return { ok: true, exists: data === true };
  } catch (error) {
    return { ok: false, error };
  }
}

/**
 * 写真1枚を1着として保存する。例外は投げない。
 * 同じ target で何度呼んでも、服・画像はそれぞれ1つだけになる。
 */
export async function registerPhotoItem(
  supabase: SupabaseClient,
  { userId, target, image }: { userId: string; target: PhotoItemTarget; image: Blob },
): Promise<RegisterPhotoItemResult> {
  if (!userId || !isPhotoItemTargetForUser(target, userId)) {
    return { ok: false, stage: "item", retryable: false, reason: "invalid" };
  }
  if (image.size === 0 || image.size > MAX_PHOTO_UPLOAD_BYTES) {
    return { ok: false, stage: "upload", retryable: false, reason: "invalid" };
  }
  let resumed = false;

  // 1. 服の行
  let itemError: unknown = null;
  try {
    const { error } = await supabase.from("clothing_items").insert({
      id: target.itemId,
      user_id: userId,
      title: PHOTO_ONLY_TITLE,
      category: PHOTO_ONLY_CATEGORY,
      seasons: [],
      season: null,
    });
    itemError = error;
  } catch (error) {
    itemError = error ?? new Error("insert failed");
  }
  if (itemError) {
    const definite = isDefiniteDbError(itemError);
    // 23505（既にある）か結果不明なら、本人の服の行があるかを確かめる
    if (errorCode(itemError) === "23505" || !definite) {
      const found = await findOwnItem(supabase, userId, target.itemId);
      if (!found.ok) {
        return { ok: false, stage: "item", retryable: true, reason: "unknown", error: found.error };
      }
      if (found.exists) {
        resumed = true;
      } else if (errorCode(itemError) === "23505") {
        // 同じIDの行があるのに本人の行として見えない（他人の行）。使わない
        return { ok: false, stage: "item", retryable: false, reason: "conflict", error: itemError };
      } else {
        return { ok: false, stage: "item", retryable: true, reason: "unknown", error: itemError };
      }
    } else {
      return {
        ok: false,
        stage: "item",
        retryable: false,
        reason: failureReason(itemError),
        error: itemError,
      };
    }
  }

  // 2. 画像のアップロード（パスはこの写真専用のため、既にあれば前回の自分のアップロード）
  let uploadError: unknown = null;
  try {
    const { error } = await supabase.storage
      .from(CLOTHING_IMAGE_BUCKET)
      .upload(target.imagePath, image, { contentType: "image/jpeg", upsert: false });
    uploadError = error;
  } catch (error) {
    uploadError = error ?? new Error("upload failed");
  }
  if (uploadError) {
    if (isStorageDuplicate(uploadError)) {
      resumed = true;
    } else if (isDefiniteStorageRejection(uploadError)) {
      return {
        ok: false,
        stage: "upload",
        retryable: false,
        reason:
          (uploadError as ErrorLike).statusCode === "403" ||
          (uploadError as ErrorLike).status === 403
            ? "denied"
            : "invalid",
        error: uploadError,
      };
    } else {
      // 結果不明: アップロードされたかを確かめる（ファイルは取得せず、存在だけを確認）
      const found = await storageObjectExists(supabase, target.imagePath);
      if (!found.ok || !found.exists) {
        return {
          ok: false,
          stage: "upload",
          retryable: true,
          reason: "unknown",
          error: found.ok ? uploadError : found.error,
        };
      }
      resumed = true;
    }
  }

  // 3. 画像の行
  let imageError: unknown = null;
  try {
    const { error } = await supabase.from("clothing_images").insert({
      clothing_item_id: target.itemId,
      image_path: target.imagePath,
      sort_order: 0,
    });
    imageError = error;
  } catch (error) {
    imageError = error ?? new Error("insert failed");
  }
  if (imageError) {
    const code = errorCode(imageError);
    if (code === "23505" || !isDefiniteDbError(imageError)) {
      // この服にこのパスの行があれば、前回の試行で保存済み
      const listed = await listItemImagePaths(supabase, target.itemId);
      if (!listed.ok) {
        return { ok: false, stage: "image", retryable: true, reason: "unknown", error: listed.error };
      }
      if (listed.paths.includes(target.imagePath)) {
        return { ok: true, resumed: true };
      }
      if (code === "23505") {
        // 同じ並び順に別の画像がある（別の画面で編集された等）。何も消さずに止める
        return { ok: false, stage: "image", retryable: false, reason: "conflict", error: imageError };
      }
      return { ok: false, stage: "image", retryable: true, reason: "unknown", error: imageError };
    }
    return {
      ok: false,
      stage: "image",
      retryable: false,
      reason: failureReason(imageError),
      error: imageError,
    };
  }

  return { ok: true, resumed };
}

// ------------------------------------------------------------
// 複数の写真を1着ずつ順に保存する
// ------------------------------------------------------------

export type PhotoBatchEntry = {
  target: PhotoItemTarget;
  image: Blob;
  /** 保存済みの写真は送らない */
  done: boolean;
};

/**
 * 写真を1着ずつ順に保存する。1着の失敗で止めず、残りの写真も保存する。
 * 保存済み（done）の写真は送らない。結果は entries と同じ順で返す（送らなかった写真は null）
 */
export async function registerPhotoBatch(
  supabase: SupabaseClient,
  {
    userId,
    entries,
    onSettled,
  }: {
    userId: string;
    entries: readonly PhotoBatchEntry[];
    /** 1着ごとの結果（画面の進み具合の更新に使う） */
    onSettled?: (index: number, result: RegisterPhotoItemResult) => void;
  },
): Promise<(RegisterPhotoItemResult | null)[]> {
  if (entries.length > MAX_PHOTO_BATCH_SIZE) {
    throw new Error(`写真は一度に${MAX_PHOTO_BATCH_SIZE}枚までです`);
  }
  const results: (RegisterPhotoItemResult | null)[] = entries.map(() => null);
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (entry.done) continue;
    const result = await registerPhotoItem(supabase, {
      userId,
      target: entry.target,
      image: entry.image,
    });
    results[i] = result;
    onSettled?.(i, result);
  }
  return results;
}

// ------------------------------------------------------------
// 登録をやめた写真の片付け
// ------------------------------------------------------------

export type DiscardPhotoItemResult =
  | { ok: true; removedItem: boolean; removedImage: boolean }
  | { ok: false; reason: "completed" | "edited" | "invalid" | "unknown"; error?: unknown };

/**
 * 途中で失敗し、登録をやめる写真の服・画像を片付ける。例外は投げない。
 * 安全のため、次の場合は何も消さない:
 * - この服に画像の行がある（保存は完了している）
 * - 服のタイトル・カテゴリーが「写真から登録した服」「other」から変わっている（編集済み）
 * - 確認の問い合わせに失敗した
 * 画像ファイルは、この写真専用のパスで、どの画像の行からも参照されていない場合だけ消す
 */
export async function discardIncompletePhotoItem(
  supabase: SupabaseClient,
  { userId, target }: { userId: string; target: PhotoItemTarget },
): Promise<DiscardPhotoItemResult> {
  if (!userId || !isPhotoItemTargetForUser(target, userId)) {
    return { ok: false, reason: "invalid" };
  }
  try {
    const listed = await listItemImagePaths(supabase, target.itemId);
    if (!listed.ok) return { ok: false, reason: "unknown", error: listed.error };
    if (listed.paths.length > 0) return { ok: false, reason: "completed" };

    const { data: referenced, error: referencedError } = await supabase
      .from("clothing_images")
      .select("id")
      .eq("image_path", target.imagePath)
      .limit(1);
    if (referencedError) return { ok: false, reason: "unknown", error: referencedError };
    if ((referenced ?? []).length > 0) return { ok: false, reason: "completed" };

    const { data: item, error: itemError } = await supabase
      .from("clothing_items")
      .select("id, user_id, title, category")
      .eq("id", target.itemId)
      .maybeSingle();
    if (itemError) return { ok: false, reason: "unknown", error: itemError };

    let removedItem = false;
    if (item) {
      if (
        item.user_id !== userId ||
        item.title !== PHOTO_ONLY_TITLE ||
        item.category !== PHOTO_ONLY_CATEGORY
      ) {
        return { ok: false, reason: "edited" };
      }
      const { data: deleted, error: deleteError } = await supabase
        .from("clothing_items")
        .delete()
        .eq("id", target.itemId)
        .eq("user_id", userId)
        .eq("title", PHOTO_ONLY_TITLE)
        .eq("category", PHOTO_ONLY_CATEGORY)
        .select("id");
      if (deleteError) return { ok: false, reason: "unknown", error: deleteError };
      removedItem = (deleted ?? []).length > 0;
    }

    const { error: removeError } = await supabase.storage
      .from(CLOTHING_IMAGE_BUCKET)
      .remove([target.imagePath]);
    if (removeError) return { ok: false, reason: "unknown", error: removeError };
    return { ok: true, removedItem, removedImage: true };
  } catch (error) {
    return { ok: false, reason: "unknown", error };
  }
}

// ------------------------------------------------------------
// 画像変換の並行数の制御
// ------------------------------------------------------------

/**
 * items を最大 limit 件ずつ並行して worker に渡す。結果は items と同じ順。
 * 1件の失敗で他を止めない。
 */
export async function runWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let next = 0;
  const runners = Array.from({ length: Math.min(Math.max(1, limit), items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      try {
        results[index] = { status: "fulfilled", value: await worker(items[index], index) };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  });
  await Promise.all(runners);
  return results;
}

export type PreparedPhoto =
  | { ok: true; image: ProcessedImage }
  | { ok: false; message: string };

/**
 * 選んだ写真を、既存の変換（向き補正・縮小・JPEG化。HEICはブラウザが読める場合のみ）で
 * 最大 PHOTO_PROCESSING_CONCURRENCY 枚ずつ変換する。
 * 1枚変換するたびに onSettled で結果を渡す（画面は受け取った順に表示を更新できる）。
 * 変換に失敗した写真は ok:false とし、他の写真は続けて変換する。
 */
export async function preparePhotoBatch(
  files: readonly File[],
  {
    // 回転は画面で選び直したときに、呼び出し側が process で指定する
    process = (file: File) => processImageForUpload(file, 0),
    concurrency = PHOTO_PROCESSING_CONCURRENCY,
    onSettled,
  }: {
    process?: (file: File) => Promise<ProcessedImage>;
    concurrency?: number;
    onSettled?: (index: number, result: PreparedPhoto) => void;
  } = {},
): Promise<PreparedPhoto[]> {
  if (files.length > MAX_PHOTO_BATCH_SIZE) {
    throw new Error(`写真は一度に${MAX_PHOTO_BATCH_SIZE}枚までです`);
  }
  const settled = await runWithConcurrency(files, concurrency, async (file, index) => {
    let result: PreparedPhoto;
    try {
      const image = await process(file);
      result =
        image.blob.size > MAX_PHOTO_UPLOAD_BYTES
          ? { ok: false, message: `${file.name}: 10MBを超える画像は登録できません` }
          : { ok: true, image };
    } catch (error) {
      result = {
        ok: false,
        message:
          error instanceof ImageProcessingError
            ? `${file.name}: ${error.message}`
            : `${file.name}: 画像を処理できませんでした`,
      };
    }
    onSettled?.(index, result);
    return result;
  });
  return settled.map((entry) =>
    entry.status === "fulfilled"
      ? entry.value
      : { ok: false, message: "画像を処理できませんでした" },
  );
}

/**
 * 同時に実行する数を limit 件までに抑える。写真を後から追加したり回転したりして
 * 変換の依頼が別々に届いても、全体で limit 件を超えて同時に変換しない。
 */
export function createConcurrencyLimiter(limit: number) {
  const max = Math.max(1, limit);
  let active = 0;
  const queue: (() => void)[] = [];
  const next = () => {
    if (active >= max) return;
    const start = queue.shift();
    if (start) start();
  };
  return function run<R>(task: () => Promise<R>): Promise<R> {
    return new Promise<R>((resolve, reject) => {
      queue.push(() => {
        active += 1;
        task()
          .then(resolve, reject)
          .finally(() => {
            active -= 1;
            next();
          });
      });
      next();
    });
  };
}
