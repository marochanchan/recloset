import {
  resolveWeeklyReviewGoal,
  type WeeklyReviewGoal,
} from "@/lib/habit-progress";
import type { SupabaseClient } from "@supabase/supabase-js";

// ============================================================
// 習慣化の設定（public.user_habit_settings、migration 017）の取得・保存
//
// - 1ユーザー1行（user_id が主キー）。行がない＝未保存（週3着として扱う）
// - weekly_review_goal: 3・7・14、または null（目標なし）。DBのCHECK制約で
//   それ以外の値は保存できない
// - RLSにより本人の行だけを読み書きできる。DELETEは許可していない
// - Supabaseクライアントは引数で受け取る（Server Componentでも、テストの
//   モックでも使えるようにする）
// ============================================================

const TABLE = "user_habit_settings";

export type WeeklyReviewGoalResult =
  | { ok: true; goal: WeeklyReviewGoal }
  | { ok: false };

/**
 * 本人の週次目標を取得する。例外は投げない。
 * - 行がない（未保存）: 3着
 * - null: 目標なし
 * - 取得に失敗: ok:false（3着に戻さず、呼び出し側で「読み込めなかった」と扱う）
 */
export async function fetchWeeklyReviewGoal(
  supabase: SupabaseClient,
): Promise<WeeklyReviewGoalResult> {
  try {
    const { data, error } = await supabase
      .from(TABLE)
      .select("weekly_review_goal")
      .maybeSingle();
    if (error) {
      console.error("fetchWeeklyReviewGoal error:", error);
      return { ok: false };
    }
    return { ok: true, goal: resolveWeeklyReviewGoal(data) };
  } catch (error) {
    console.error("fetchWeeklyReviewGoal exception:", error);
    return { ok: false };
  }
}

export type SaveWeeklyReviewGoalResult =
  | { ok: true; goal: WeeklyReviewGoal }
  | { ok: false; reason: "invalid" | "failed" };

/**
 * 本人の週次目標を保存する（行がなければ作り、あれば更新する）。例外は投げない。
 *
 * - userId は auth.getUser() で確認済みの本人のID（クライアントから受け取らない）。
 *   RLSでも user_id = auth.uid() の行しか作成・更新できない
 * - 保存後の値をDBから読み戻し、送った値と一致することを確かめる
 */
export async function saveWeeklyReviewGoal(
  supabase: SupabaseClient,
  userId: string,
  goal: WeeklyReviewGoal,
  now: Date = new Date(),
): Promise<SaveWeeklyReviewGoalResult> {
  try {
    const { data, error } = await supabase
      .from(TABLE)
      .upsert(
        {
          user_id: userId,
          weekly_review_goal: goal,
          updated_at: now.toISOString(),
        },
        { onConflict: "user_id" },
      )
      .select("weekly_review_goal")
      .single();
    if (error) {
      console.error("saveWeeklyReviewGoal error:", error);
      // 23514: CHECK制約違反（3・7・14・null 以外の値）
      return { ok: false, reason: error.code === "23514" ? "invalid" : "failed" };
    }
    if (!data || data.weekly_review_goal !== goal) {
      console.error("saveWeeklyReviewGoal: unexpected result", data);
      return { ok: false, reason: "failed" };
    }
    return { ok: true, goal };
  } catch (error) {
    console.error("saveWeeklyReviewGoal exception:", error);
    return { ok: false, reason: "failed" };
  }
}
