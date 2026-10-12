import {
  buildWeeklyProgress,
  countReviewedItems,
  getJstWeekRangeUtc,
  toReviewActivities,
  type JstWeekRange,
  type WeeklyProgress,
} from "@/lib/habit-progress";
import { fetchWeeklyReviewGoal } from "@/lib/habit-settings";
import type { SupabaseClient } from "@supabase/supabase-js";

// ============================================================
// 今週の進捗を取得する（読み取りのみ。AIは呼ばない）
//
// - 見直し: ai_diagnoses（保存済み＝成功した診断）と
//   closet_review_decisions（skipを除く）の今週の行。同じ服は1着
// - 着用記録: wear_logs の今週の件数（行は取得せず件数だけ）
// - 週次目標: user_habit_settings（migration 017）。未保存なら3着、nullは目標なし
// - RLSにより本人の行だけが返る（wear_logs は服の所有者で絞られる）
// - 見直し・着用の取得が1つでも失敗したら ok:false を返す
//   （一部だけで0着などと誤表示しない）
// - 目標だけ取得に失敗した場合は、実績は表示できるため ok:true のまま
//   goalLoadFailed:true とし、目標なしと同じく進捗率・達成判定を出さない
//   （3着に黙って戻さない）
// - Supabaseクライアントは引数で受け取る（Server Componentでも、テストの
//   モックでも使えるようにする）。集計は lib/habit-progress.ts の純粋関数
// ============================================================

// 1週間分の上限（1人の1週間の見直しでは届かない値。超えたら数え漏れを避けるため失敗扱い）
const WEEKLY_ROWS_LIMIT = 1000;

export type WeeklyProgressResult =
  | {
      ok: true;
      range: JstWeekRange;
      progress: WeeklyProgress;
      /** 目標の取得に失敗した（progress.goal は null で、進捗率・達成判定はない） */
      goalLoadFailed: boolean;
    }
  | { ok: false };

export async function fetchWeeklyProgress(
  supabase: SupabaseClient,
  now: Date = new Date(),
): Promise<WeeklyProgressResult> {
  const range = getJstWeekRangeUtc(now);
  const start = range.startUtc.toISOString();
  const end = range.endUtc.toISOString();

  try {
    const [aiResult, swipeResult, wearResult, goalResult] = await Promise.all([
      supabase
        .from("ai_diagnoses")
        .select("clothing_item_id, created_at")
        .gte("created_at", start)
        .lt("created_at", end)
        .limit(WEEKLY_ROWS_LIMIT),
      supabase
        .from("closet_review_decisions")
        .select("clothing_item_id, decision, created_at")
        .neq("decision", "skip")
        .gte("created_at", start)
        .lt("created_at", end)
        .limit(WEEKLY_ROWS_LIMIT),
      supabase
        .from("wear_logs")
        .select("*", { count: "exact", head: true })
        .gte("worn_at", start)
        .lt("worn_at", end),
      // 例外を投げず、失敗は ok:false で返る
      fetchWeeklyReviewGoal(supabase),
    ]);

    if (aiResult.error || swipeResult.error || wearResult.error) {
      console.error(
        "fetchWeeklyProgress error:",
        aiResult.error ?? swipeResult.error ?? wearResult.error,
      );
      return { ok: false };
    }
    if (
      !aiResult.data ||
      !swipeResult.data ||
      typeof wearResult.count !== "number" ||
      aiResult.data.length >= WEEKLY_ROWS_LIMIT ||
      swipeResult.data.length >= WEEKLY_ROWS_LIMIT
    ) {
      console.error("fetchWeeklyProgress: unexpected result");
      return { ok: false };
    }

    const activities = toReviewActivities({
      aiDiagnoses: aiResult.data,
      swipeDecisions: swipeResult.data,
    });
    // 目標は表示のたびに今の設定で計算するため、週の途中で変えても
    // 今週の進捗率は新しい目標で計算し直される
    return {
      ok: true,
      range,
      progress: buildWeeklyProgress({
        reviewedItemCount: countReviewedItems(activities, range),
        wearLogCount: wearResult.count,
        goal: goalResult.ok ? goalResult.goal : null,
      }),
      goalLoadFailed: !goalResult.ok,
    };
  } catch (error) {
    console.error("fetchWeeklyProgress exception:", error);
    return { ok: false };
  }
}
