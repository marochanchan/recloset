"use server";

import { analyzeClothingImage } from "@/lib/clothing-image-analysis";
import {
  CATEGORY_OPTIONS,
  normalizeSeasons,
  type SeasonValue,
} from "@/lib/clothing-options";
import { createClient } from "@/lib/supabase/server";

// 登録フォームから送るAI用画像（lib/image-processing.ts の
// processImageForAnalysis で長辺1024px・JPEGにしたもの。通常150KB前後）。
// Server Actionの本文上限（1MB）より小さい値にしておく。
const MAX_ANALYSIS_IMAGE_BYTES = 900 * 1024;

// タイトル候補の上限（PoCのスキーマと同じ30文字）
const MAX_TITLE_LENGTH = 30;

// 同じユーザーが短時間に何度も呼べないようにする簡易的な上限。
// サーバーのインスタンスごとのメモリで数えるため厳密ではない
// （最終的な支出上限はAI Gateway側のBudgetで設定する）。
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 10;
const recentRequestsByUser = new Map<string, number[]>();

function isRateLimited(userId: string): boolean {
  const now = Date.now();
  const recent = (recentRequestsByUser.get(userId) ?? []).filter(
    (time) => now - time < RATE_LIMIT_WINDOW_MS,
  );
  if (recent.length >= RATE_LIMIT_MAX_REQUESTS) {
    recentRequestsByUser.set(userId, recent);
    return true;
  }
  recent.push(now);
  recentRequestsByUser.set(userId, recent);
  return false;
}

function isJpeg(bytes: Uint8Array): boolean {
  return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

type CategoryValue = (typeof CATEGORY_OPTIONS)[number]["value"];

export type ClothingImageAutofillResult =
  | {
      ok: true;
      isClothing: boolean;
      title: string | null;
      category: CategoryValue | null;
      /** 着られる季節の候補。判定できなかった場合はnull（未設定のままにする） */
      seasons: SeasonValue[] | null;
      /** 季節は写真だけでは判断しにくいため、確認を促す場合にtrue */
      seasonsNeedsCheck: boolean;
    }
  | { ok: false; error: string };

/**
 * 登録フォームの代表画像1枚をAIで解析し、タイトル・カテゴリー・季節の候補を返す。
 * - 認証済みユーザーだけが使える（user_idはクライアントから受け取らない）
 * - 画像・解析結果はStorageにもDBにも保存しない
 * - 失敗してもフォームの通常の登録は続けられるよう、短い案内文だけを返す
 */
export async function analyzeClothingImageForAutofill(
  formData: FormData,
): Promise<ClothingImageAutofillResult> {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user) {
    return { ok: false, error: "ログイン情報が確認できませんでした" };
  }

  const image = formData.get("image");
  if (!(image instanceof Blob) || image.size === 0) {
    return { ok: false, error: "画像を読み取れませんでした" };
  }
  if (image.size > MAX_ANALYSIS_IMAGE_BYTES) {
    return { ok: false, error: "画像が大きすぎるため読み取れませんでした" };
  }
  const bytes = new Uint8Array(await image.arrayBuffer());
  if (!isJpeg(bytes)) {
    return { ok: false, error: "画像を読み取れませんでした" };
  }

  if (isRateLimited(user.id)) {
    return {
      ok: false,
      error: "読み取りが続いたため、少し時間をおいてお試しください",
    };
  }

  try {
    const analysis = await analyzeClothingImage(bytes);
    if (!analysis.is_clothing) {
      return {
        ok: true,
        isClothing: false,
        title: null,
        category: null,
        seasons: null,
        seasonsNeedsCheck: false,
      };
    }

    // カテゴリーはアプリの選択肢と完全一致するものだけを採用する
    const category =
      CATEGORY_OPTIONS.find((option) => option.value === analysis.category)
        ?.value ?? null;
    const title =
      analysis.suggested_title?.trim().slice(0, MAX_TITLE_LENGTH) || null;

    const seasons = normalizeSeasons(analysis.suggested_seasons);
    const seasonsNeedsCheck =
      seasons.length > 0 &&
      (analysis.confidence.seasons === "low" ||
        analysis.needs_user_check.includes("seasons"));

    return {
      ok: true,
      isClothing: true,
      title,
      category,
      seasons: seasons.length > 0 ? seasons : null,
      seasonsNeedsCheck,
    };
  } catch (error) {
    // 画像やAPIキーはログに出さない（エラーの種類だけを残す）
    console.error(
      "analyzeClothingImageForAutofill failed:",
      error instanceof Error ? `${error.name}: ${error.message}` : error,
    );
    return {
      ok: false,
      error: "写真から読み取れませんでした。そのまま入力して登録できます",
    };
  }
}
