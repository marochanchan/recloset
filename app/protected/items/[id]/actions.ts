"use server";

import { STATUS_OPTIONS } from "@/lib/clothing-options";
import { createClient } from "@/lib/supabase/server";
import { hasWornToday } from "@/lib/wear-logs";
import { revalidatePath } from "next/cache";

type RecordWearTodayResult = {
  error: string | null;
};

type UpdateStatusResult = {
  error: string | null;
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
