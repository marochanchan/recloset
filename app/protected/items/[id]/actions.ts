"use server";

import {
  type DiagnosisDecisionChoice,
  type DiagnosisFact,
  type DiagnosisFeelingInput,
  type JevDiagnosisResult,
  runJevDiagnosis,
  validateFeelingInput,
} from "@/lib/ai-diagnosis";
import { GEMINI_ELABORATION_MODEL, runGeminiElaboration } from "@/lib/ai-elaboration";
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
      /**
       * ai_diagnoses履歴の行id。履歴保存（INSERT）自体が失敗した場合は
       * nullになる。診断結果の表示はこれに関わらず行う
       * （履歴保存失敗は診断結果表示を妨げない、という既存方針を維持）。
       * generateDiagnosisElaborationを呼ぶために必要なため、
       * nullの場合は「もっと詳しく考える」ボタンを表示しない。
       */
      diagnosisId: string | null;
    };

type GenerateDiagnosisElaborationResult =
  | { error: string }
  | { error: null; elaboration: string; geminiModel: string };

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
 * 診断結果は ai_diagnoses に履歴として保存する（履歴保存自体の失敗は
 * ユーザーへの診断結果表示を妨げない。console.errorにのみ記録する）。
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
    const nextAction = buildNextAction(decision.choice, fact, feeling);

    // 履歴として保存する。失敗してもユーザーには今回の診断結果を
    // そのまま返す（履歴保存はその場の診断結果表示の必須条件ではない）。
    // Gemini呼び出しはここでは一切行わない
    // （generateDiagnosisElaborationとして完全に独立させている）。
    const { data: insertedDiagnosis, error: insertError } = await supabase
      .from("ai_diagnoses")
      .insert({
        clothing_item_id: itemId,
        user_id: user.id,
        decision: decision.choice,
        decision_probabilities: decision.probabilities,
        fact,
        feeling,
        next_action: nextAction,
        model: "typesafe-ai/jev",
      })
      .select("id")
      .single();
    if (insertError) {
      console.error("runAiDiagnosis: insert ai_diagnoses error", insertError);
    }

    return {
      error: null,
      decision,
      nextAction,
      diagnosisId: insertedDiagnosis?.id ?? null,
    };
  } catch (error) {
    console.error("runAiDiagnosis: Jev evaluate error", error);
    return {
      error: "AI診断に失敗しました。時間をおいて再度お試しください。",
    };
  }
}

/**
 * 「もっと詳しく考える」が押されたときだけ呼ばれる、独立したServer Action。
 * runAiDiagnosisの中からは呼ばれない（通常の診断フローではGeminiを使わない）。
 *
 * クライアントからFACT/FEELING等を再送させず、DBに保存済みの診断スナップショット
 * （ai_diagnosesの該当行）をサーバー側で取得して使う。
 *
 * 1診断につきGemini補足は最大1回:
 * - 既にelaborationが入っている場合はGeminiを呼ばず、保存済みの値をそのまま返す
 * - 新規生成時も、UPDATE対象はelaboration/gemini_model列のみ（migration 006の
 *   列GRANT・RLSにより、decision/fact/feeling/next_action等は書き換えられず、
 *   既にelaborationがある行への再UPDATEもDBレベルで0件になる）
 */
export async function generateDiagnosisElaboration(
  diagnosisId: string,
): Promise<GenerateDiagnosisElaborationResult> {
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user) {
    return { error: "ログイン情報が確認できませんでした" };
  }

  // RLSにより、自分が所有する診断履歴でなければ取得できない
  const { data: diagnosis, error: fetchError } = await supabase
    .from("ai_diagnoses")
    .select("decision, fact, feeling, next_action, elaboration, gemini_model")
    .eq("id", diagnosisId)
    .maybeSingle();

  if (fetchError) {
    console.error(
      "generateDiagnosisElaboration: fetch diagnosis error",
      fetchError,
    );
    return { error: "診断履歴を取得できませんでした" };
  }
  if (!diagnosis) {
    return { error: "対象の診断履歴が見つかりません" };
  }

  // 既に生成済みなら、Geminiを呼ばず既存の補足をそのまま返す
  if (diagnosis.elaboration) {
    return {
      error: null,
      elaboration: diagnosis.elaboration,
      geminiModel: diagnosis.gemini_model ?? GEMINI_ELABORATION_MODEL,
    };
  }

  try {
    const elaboration = await runGeminiElaboration({
      decision: diagnosis.decision as DiagnosisDecisionChoice,
      fact: diagnosis.fact as DiagnosisFact,
      feeling: diagnosis.feeling as DiagnosisFeelingInput,
      nextAction: diagnosis.next_action as Pick<
        NextAction,
        "title" | "message"
      >,
    });

    // elaboration/gemini_model列だけをUPDATEする。既存の診断スナップショット
    // （decision/fact/feeling/next_action）には一切触れない。
    const { error: updateError } = await supabase
      .from("ai_diagnoses")
      .update({
        elaboration,
        gemini_model: GEMINI_ELABORATION_MODEL,
      })
      .eq("id", diagnosisId);
    if (updateError) {
      console.error(
        "generateDiagnosisElaboration: update error",
        updateError,
      );
    }

    return {
      error: null,
      elaboration,
      geminiModel: GEMINI_ELABORATION_MODEL,
    };
  } catch (error) {
    console.error("generateDiagnosisElaboration: Gemini error", error);
    return {
      error:
        "詳しいコメントを生成できませんでした。診断結果はそのまま確認できます。",
    };
  }
}
