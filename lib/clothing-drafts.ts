import {
  isColorValue,
  isSubcategoryForCategory,
  normalizeSeasons,
  type SeasonValue,
} from "@/lib/clothing-options";
import type { SupabaseClient } from "@supabase/supabase-js";

// ============================================================
// 服登録の下書き（public.clothing_item_drafts、migration 014）
//
// - 入力途中のフォームの値は fields（jsonb）、写真は Storage の
//   {uid}/drafts/{draftId}/{uuid}.jpg に保存する（本人のフォルダの下なので、
//   既存のStorageポリシーで本人だけが読み書きでき、公開されない）
// - 下書きは clothing_items とは別テーブルのため、Closet・Today・AI診断・
//   Loop・公開RPCには混ざらない
// - 写真は「新しく選んだ画像」と同じ処理済みJPEGをそのまま保存する
//   （回転・並び順を反映した状態で保存され、再開時にそのまま戻る）
// ============================================================

export const CLOTHING_IMAGE_BUCKET = "clothing-images";
export const MAX_DRAFT_IMAGES = 5;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isDraftId(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

/** 下書きに保存するフォームの値（文字列は入力欄の値そのまま） */
export type DraftFields = {
  title: string;
  brand: string;
  category: string;
  subcategory: string;
  mainColor: string;
  seasons: SeasonValue[];
  purchaseDate: string;
  purchasePrice: string;
  favorite: boolean;
  marketplaceUrls: { mercari: string; rakuma: string; yahooFurima: string };
};

export const EMPTY_DRAFT_FIELDS: DraftFields = {
  title: "",
  brand: "",
  category: "",
  subcategory: "",
  mainColor: "",
  seasons: [],
  purchaseDate: "",
  purchasePrice: "",
  favorite: false,
  marketplaceUrls: { mercari: "", rakuma: "", yahooFurima: "" },
};

const asString = (value: unknown, maxLength = 2000) =>
  typeof value === "string" ? value.slice(0, maxLength) : "";

/**
 * DBから読んだ fields を、フォームで使える形に整える
 * （想定外の値は空に戻す。種類はカテゴリーに属する場合だけ残す）。
 */
export function normalizeDraftFields(raw: unknown): DraftFields {
  const value = (raw && typeof raw === "object" ? raw : {}) as Record<
    string,
    unknown
  >;
  const urls = (
    value.marketplaceUrls && typeof value.marketplaceUrls === "object"
      ? value.marketplaceUrls
      : {}
  ) as Record<string, unknown>;
  const category = asString(value.category, 50);
  return {
    title: asString(value.title, 200),
    brand: asString(value.brand, 200),
    category,
    subcategory: isSubcategoryForCategory(category, value.subcategory)
      ? value.subcategory
      : "",
    mainColor: isColorValue(value.mainColor) ? value.mainColor : "",
    seasons: normalizeSeasons(
      Array.isArray(value.seasons) ? value.seasons : [],
    ),
    purchaseDate: asString(value.purchaseDate, 20),
    purchasePrice: asString(value.purchasePrice, 20),
    favorite: value.favorite === true,
    marketplaceUrls: {
      mercari: asString(urls.mercari),
      rakuma: asString(urls.rakuma),
      yahooFurima: asString(urls.yahooFurima),
    },
  };
}

/** 下書きの写真のパスとして正しい形か（本人・この下書きのフォルダの中だけ） */
export function isDraftImagePath(
  path: unknown,
  userId: string,
  draftId: string,
): path is string {
  return (
    typeof path === "string" &&
    path.startsWith(`${userId}/drafts/${draftId}/`) &&
    !path.includes("..")
  );
}

/** 下書きの写真の一覧と、各写真の保存先 */
export type DraftImageInput = {
  key: string;
  /** すでにこの下書きに保存済みの画像ならそのパス（再アップロードしない） */
  draftPath: string | null;
  /** 保存する画像（処理済みJPEG） */
  blob: Blob;
};

export type SaveDraftResult = {
  draftId: string;
  imagePaths: string[];
  /** 画像のkey → 保存先パス */
  pathByKey: Record<string, string>;
  /** 使われなくなった古い画像の削除に失敗した（下書き自体は保存済み） */
  staleCleanupFailed: boolean;
};

/**
 * 下書きを保存する（新規作成または更新）。
 * 既存の正常な下書きを壊さないよう、次の順で行う:
 *   1. 新しい画像だけを新しいパスへアップロードする（既存の画像は上書きしない）
 *   2. DBの行を作成・更新する（写真の一覧と並び順を差し替える）
 *   3. 2が失敗したら、1でアップロードした画像だけを消して終える
 *      （DBの行と、前回保存した画像はそのまま。再試行できる）
 *   4. 2が成功した後にだけ、使われなくなった前回の画像を削除する
 */
export async function saveClothingDraft({
  supabase,
  userId,
  draftId,
  fields,
  images,
  previousPaths,
}: {
  supabase: SupabaseClient;
  userId: string;
  draftId: string | null;
  fields: DraftFields;
  images: DraftImageInput[];
  previousPaths: string[];
}): Promise<SaveDraftResult> {
  if (images.length > MAX_DRAFT_IMAGES) {
    throw new Error(`写真は${MAX_DRAFT_IMAGES}枚までです`);
  }
  const id = draftId ?? crypto.randomUUID();
  const uploaded: string[] = [];
  const imagePaths: string[] = [];
  const pathByKey: Record<string, string> = {};

  try {
    for (const image of images) {
      let path = image.draftPath;
      if (!path || !isDraftImagePath(path, userId, id)) {
        path = `${userId}/drafts/${id}/${crypto.randomUUID()}.jpg`;
        const { error: uploadError } = await supabase.storage
          .from(CLOTHING_IMAGE_BUCKET)
          .upload(path, image.blob, { contentType: "image/jpeg" });
        if (uploadError) throw uploadError;
        uploaded.push(path);
      }
      imagePaths.push(path);
      pathByKey[image.key] = path;
    }

    const row = {
      fields,
      image_paths: imagePaths,
      updated_at: new Date().toISOString(),
    };
    if (draftId) {
      // RLSにより本人の下書きしか更新できない（0件なら見つからない扱い）
      const { data, error } = await supabase
        .from("clothing_item_drafts")
        .update(row)
        .eq("id", draftId)
        .select("id")
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error("下書きが見つかりませんでした");
    } else {
      const { error } = await supabase
        .from("clothing_item_drafts")
        .insert({ id, user_id: userId, ...row });
      if (error) throw error;
    }
  } catch (error) {
    if (uploaded.length > 0) {
      const { error: removeError } = await supabase.storage
        .from(CLOTHING_IMAGE_BUCKET)
        .remove(uploaded);
      if (removeError) {
        console.error("draft upload cleanup failed:", removeError);
      }
    }
    throw error;
  }

  let staleCleanupFailed = false;
  const stalePaths = previousPaths.filter((path) => !imagePaths.includes(path));
  if (stalePaths.length > 0) {
    const { error: removeError } = await supabase.storage
      .from(CLOTHING_IMAGE_BUCKET)
      .remove(stalePaths);
    if (removeError) {
      console.error("draft stale image cleanup failed:", removeError);
      staleCleanupFailed = true;
    }
  }

  return { draftId: id, imagePaths, pathByKey, staleCleanupFailed };
}

/**
 * 下書きを削除する（一覧からの削除・登録完了後の片付け）。
 * 先にDBの行を消し、その後で写真を消す
 * （写真を先に消して行の削除に失敗すると、写真のない下書きが残るため）。
 * 消す写真は、削除した行に保存されていた image_paths を使う。
 * 行の削除に失敗した場合は false を返す（写真は消さない）。
 */
export async function deleteClothingDraft({
  supabase,
  draftId,
}: {
  supabase: SupabaseClient;
  draftId: string;
}): Promise<boolean> {
  const { data, error } = await supabase
    .from("clothing_item_drafts")
    .delete()
    .eq("id", draftId)
    .select("id, image_paths")
    .maybeSingle();
  if (error || !data) {
    console.error("draft delete failed:", error ?? "not found");
    return false;
  }
  const imagePaths: string[] = Array.isArray(data.image_paths)
    ? data.image_paths
    : [];
  if (imagePaths.length > 0) {
    const { error: removeError } = await supabase.storage
      .from(CLOTHING_IMAGE_BUCKET)
      .remove(imagePaths);
    if (removeError) {
      // 行は削除済みのため、残った写真は本人以外から見えない（ログのみ）
      console.error("draft image cleanup failed:", removeError);
    }
  }
  return true;
}
