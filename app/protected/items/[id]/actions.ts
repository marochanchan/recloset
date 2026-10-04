"use server";

import {
  type DiagnosisFact,
  type JevDiagnosisResult,
  runJevDiagnosis,
  validateFeelingInput,
} from "@/lib/ai-diagnosis";
import { STATUS_OPTIONS } from "@/lib/clothing-options";
import { type NextAction, buildNextAction } from "@/lib/next-action";
import { createClient } from "@/lib/supabase/server";
import {
  getCurrentSeasonJst,
  getDaysSinceLastWorn,
  getDaysSincePurchase,
  hasWornToday,
} from "@/lib/wear-logs";
import { revalidatePath } from "next/cache";

type RecordWearTodayResult = {
  error: string | null;
};

type UpdateStatusResult = {
  error: string | null;
};

type DeleteClothingItemResult = {
  error: string | null;
};

type RunAiDiagnosisResult =
  | { error: string }
  | {
      error: null;
      decision: JevDiagnosisResult;
      nextAction: NextAction;
    };

export async function recordWearToday(
  itemId: string,
): Promise<RecordWearTodayResult> {
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user) {
    return { error: "ログイン情報が確認できませんでした" };
  }

  // RLSにより、自分が所有する服でなければ取得できない
  const { data: item, error: itemError } = await supabase
    .from("clothing_items")
    .select("id, wear_count")
    .eq("id", itemId)
    .maybeSingle();

  if (itemError) {
    console.error("recordWearToday: fetch item error", itemError);
    return { error: "服の情報を取得できませんでした" };
  }
  if (!item) {
    return { error: "対象の服が見つかりません" };
  }

  if (await hasWornToday(supabase, itemId)) {
    // 既に今日の記録がある場合は何もしない（二重登録防止）
    revalidatePath(`/protected/items/${itemId}`);
    return { error: null };
  }

  const now = new Date();

  const { error: insertError } = await supabase.from("wear_logs").insert({
    clothing_item_id: itemId,
    worn_at: now.toISOString(),
  });
  if (insertError) {
    console.error("recordWearToday: insert wear_logs error", insertError);
    return { error: "着用記録の登録に失敗しました" };
  }

  // wear_logsが一次データ、wear_count/last_worn_atは派生値。
  // ここでの失敗はrace conditionと合わせて将来RPC化するTODO。
  const { error: updateError } = await supabase
    .from("clothing_items")
    .update({
      wear_count: item.wear_count + 1,
      last_worn_at: now.toISOString(),
    })
    .eq("id", itemId);
  if (updateError) {
    console.error("recordWearToday: update clothing_items error", updateError);
    revalidatePath(`/protected/items/${itemId}`);
    return {
      error:
        "着用記録は保存されましたが、回数の更新に失敗しました。再読み込みしてご確認ください。",
    };
  }

  revalidatePath(`/protected/items/${itemId}`);
  return { error: null };
}

export async function updateClothingItemStatus(
  itemId: string,
  status: string,
): Promise<UpdateStatusResult> {
  const validStatuses: string[] = STATUS_OPTIONS.map((option) => option.value);
  if (!validStatuses.includes(status)) {
    return { error: "不正なステータスです" };
  }

  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user) {
    return { error: "ログイン情報が確認できませんでした" };
  }

  // RLSにより、自分が所有する服でなければ取得できない
  const { data: item, error: itemError } = await supabase
    .from("clothing_items")
    .select("id")
    .eq("id", itemId)
    .maybeSingle();

  if (itemError) {
    console.error("updateClothingItemStatus: fetch item error", itemError);
    return { error: "服の情報を取得できませんでした" };
  }
  if (!item) {
    return { error: "対象の服が見つかりません" };
  }

  const { error: updateError } = await supabase
    .from("clothing_items")
    .update({ status })
    .eq("id", itemId);
  if (updateError) {
    console.error("updateClothingItemStatus: update error", updateError);
    return { error: "ステータスの更新に失敗しました" };
  }

  revalidatePath(`/protected/items/${itemId}`);
  return { error: null };
}

/**
 * clothing_itemsを削除する。
 * clothing_images / wear_logs は on delete cascade によりDB側で削除される
 * （将来、AI診断履歴・Rebuy関連テーブルを clothing_item_id に
 * on delete cascade で追加しても、この関数自体の変更は不要）。
 *
 * Storage上の画像ファイルはDBのCASCADEでは削除されないため、
 * DB削除が成功した後にこの関数内でStorageからも削除する。
 * Storage削除が失敗しても、既に成功しているDB削除を失敗として
 * 扱わない（ユーザーには成功を返し、失敗はログにのみ残す）。
 */
export async function deleteClothingItem(
  itemId: string,
): Promise<DeleteClothingItemResult> {
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user) {
    return { error: "ログイン情報が確認できませんでした" };
  }

  // RLSにより、自分が所有する服でなければ取得できない。
  // Storage削除のため、DB削除前にimage_pathを取得しておく。
  const { data: item, error: itemError } = await supabase
    .from("clothing_items")
    .select("id, clothing_images(image_path)")
    .eq("id", itemId)
    .maybeSingle();

  if (itemError) {
    console.error("deleteClothingItem: fetch item error", itemError);
    return { error: "服の情報を取得できませんでした" };
  }
  if (!item) {
    return { error: "対象の服が見つかりません" };
  }

  const imagePaths = item.clothing_images.map(
    (image: { image_path: string }) => image.image_path,
  );

  const { error: deleteError } = await supabase
    .from("clothing_items")
    .delete()
    .eq("id", itemId);
  if (deleteError) {
    console.error("deleteClothingItem: delete error", deleteError);
    return { error: "服の削除に失敗しました" };
  }

  if (imagePaths.length > 0) {
    const { error: removeError } = await supabase.storage
      .from("clothing-images")
      .remove(imagePaths);
    if (removeError) {
      console.error("deleteClothingItem: storage cleanup failed", removeError);
    }
  }

  revalidatePath("/protected/items");
  return { error: null };
}

/**
 * itemIdとFEELING回答からAI診断（Jev）を実行する。
 * DBへの保存は行わない（その場限りの診断結果を返すだけ）。
 * clothing_items.status は診断結果によって自動更新しない。
 */
export async function runAiDiagnosis(
  itemId: string,
  feelingInput: {
    currentFeeling: string;
    wantToWearAgain: string;
    notWornReasons: string[];
  },
): Promise<RunAiDiagnosisResult> {
  // クライアントのFEELING回答は許可リストで検証してから使う
  const feeling = validateFeelingInput(feelingInput);
  if (!feeling) {
    return { error: "回答の内容が正しくありません" };
  }

  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user) {
    return { error: "ログイン情報が確認できませんでした" };
  }

  // RLSにより、自分が所有する服でなければ取得できない。
  // FACTはここで取得した値のみを使い、クライアントから受け取った値は使わない。
  // status は過去のユーザー判断であり客観的な利用実績ではないため取得しない。
  const { data: item, error: itemError } = await supabase
    .from("clothing_items")
    .select("wear_count, favorite, category, season, purchase_date, last_worn_at")
    .eq("id", itemId)
    .maybeSingle();

  if (itemError) {
    console.error("runAiDiagnosis: fetch item error", itemError);
    return { error: "服の情報を取得できませんでした" };
  }
  if (!item) {
    return { error: "対象の服が見つかりません" };
  }

  const fact: DiagnosisFact = {
    wear_count: item.wear_count,
    days_since_last_worn: getDaysSinceLastWorn(item.last_worn_at),
    days_since_purchase: getDaysSincePurchase(item.purchase_date),
    favorite: item.favorite,
    category: item.category,
    season: item.season,
    current_season: getCurrentSeasonJst(),
  };

  try {
    const decision = await runJevDiagnosis(fact, feeling);
    return {
      error: null,
      decision,
      nextAction: buildNextAction(decision.choice, fact, feeling),
    };
  } catch (error) {
    console.error("runAiDiagnosis: Jev evaluate error", error);
    return {
      error: "AI診断に失敗しました。時間をおいて再度お試しください。",
    };
  }
}
