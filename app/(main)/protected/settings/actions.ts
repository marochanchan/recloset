"use server";

import { validateDisplayName } from "@/lib/display-name";
import {
  parseWeeklyReviewGoalValue,
  type WeeklyReviewGoal,
} from "@/lib/habit-progress";
import { saveWeeklyReviewGoal } from "@/lib/habit-settings";
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

type UpdateDisplayNameResult =
  | { error: string; displayName: null }
  | { error: null; displayName: string };

/**
 * ログインユーザー本人の公開名（profiles.display_name）を更新する。
 * - 対象ユーザーはクライアントから受け取らず、auth.getUser()の結果だけを使う
 * - 更新する列はdisplay_nameだけ（DB側でも列単位GRANTでdisplay_nameしか
 *   更新できず、RLSで本人の行しか更新できない。migration 009）
 * - 入力は前後の空白を取り除いてから検証する。DBのCHECK制約が最終防衛線
 */
export async function updateDisplayName(
  input: string,
): Promise<UpdateDisplayNameResult> {
  if (typeof input !== "string") {
    return { error: "公開名を入力してください", displayName: null };
  }

  const validated = validateDisplayName(input);
  if (validated.error !== null) {
    return { error: validated.error, displayName: null };
  }

  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user) {
    return { error: "ログイン情報が確認できませんでした", displayName: null };
  }

  const { data: updated, error: updateError } = await supabase
    .from("profiles")
    .update({ display_name: validated.value })
    .eq("id", user.id)
    .select("display_name")
    .maybeSingle();

  if (updateError) {
    console.error("updateDisplayName: update error", updateError);
    // 23514: CHECK制約違反（アプリ側の検証をすり抜けた不正な値）
    if (updateError.code === "23514") {
      return {
        error: "この公開名は使えません。別の名前を入力してください",
        displayName: null,
      };
    }
    return { error: "公開名の保存に失敗しました", displayName: null };
  }
  if (!updated) {
    return { error: "プロフィールが見つかりませんでした", displayName: null };
  }

  revalidatePath("/protected/settings");
  revalidatePath("/me");
  // 公開中の服がある場合、一覧・詳細の「公開した人」に新しい名前を反映する
  revalidatePath("/(main)/discover", "layout");
  return { error: null, displayName: updated.display_name as string };
}

type UpdateWeeklyReviewGoalResult =
  | { error: string; goal?: undefined }
  | { error: null; goal: WeeklyReviewGoal };

/**
 * ログインユーザー本人の週次の見直し目標（user_habit_settings、migration 017）を保存する。
 * - 対象ユーザーはクライアントから受け取らず、auth.getUser()の結果だけを使う
 * - 受け付ける値は "3"・"7"・"14"・"none"（目標なし）だけ。DBのCHECK制約が最終防衛線
 * - 保存後、Todayの進捗に新しい目標を反映する（今週の進捗率も新しい目標で計算される）
 */
export async function updateWeeklyReviewGoal(
  input: unknown,
): Promise<UpdateWeeklyReviewGoalResult> {
  const parsed = parseWeeklyReviewGoalValue(input);
  if (!parsed.ok) {
    return { error: "目標を選択肢から選んでください" };
  }

  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user) {
    return { error: "ログイン情報が確認できませんでした" };
  }

  const saved = await saveWeeklyReviewGoal(supabase, user.id, parsed.goal);
  if (!saved.ok) {
    return {
      error:
        saved.reason === "invalid"
          ? "目標を選択肢から選んでください"
          : "目標の保存に失敗しました。時間をおいてもう一度お試しください",
    };
  }

  revalidatePath("/protected/settings");
  revalidatePath("/today");
  return { error: null, goal: saved.goal };
}
