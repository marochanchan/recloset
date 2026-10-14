import { toClosetActivities } from "@/lib/closet-activity";
import { getJstWeekRangeUtc, toReviewActivities } from "@/lib/habit-progress";
import { buildReQuestProgress, type ReQuestProgress } from "@/lib/re-quest";
import type { SupabaseClient } from "@supabase/supabase-js";

// ============================================================
// Re:Quest のデータ取得（今週＝日本時間の月曜0:00〜翌月曜0:00の記録だけを読む）
// - RLSにより本人の行だけが返る
// - 必要な列だけを読む。上限件数に達したら、数え漏れを避けるため読み込みエラーにする
//   （lib/habit-progress-query.ts と同じ方針）
// - 例外は投げない
// ============================================================

const WEEKLY_ROWS_LIMIT = 1000;

export type ReQuestResult = { ok: true; progress: ReQuestProgress } | { ok: false };

export async function fetchReQuestProgress(
  supabase: SupabaseClient,
  now: Date = new Date(),
): Promise<ReQuestResult> {
  const range = getJstWeekRangeUtc(now);
  const start = range.startUtc.toISOString();
  const end = range.endUtc.toISOString();

  try {
    const [itemsResult, aiResult, swipeResult, wearResult] = await Promise.all([
      supabase
        .from("clothing_items")
        .select("id, created_at")
        .gte("created_at", start)
        .lt("created_at", end)
        .limit(WEEKLY_ROWS_LIMIT),
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
        .select("clothing_item_id, worn_at")
        .gte("worn_at", start)
        .lt("worn_at", end)
        .limit(WEEKLY_ROWS_LIMIT),
    ]);

    const results = [itemsResult, aiResult, swipeResult, wearResult];
    const failed = results.find((result) => result.error);
    if (failed) {
      console.error("fetchReQuestProgress error:", failed.error);
      return { ok: false };
    }
    if (
      results.some(
        (result) => !result.data || result.data.length >= WEEKLY_ROWS_LIMIT,
      )
    ) {
      console.error("fetchReQuestProgress: unexpected result or limit reached");
      return { ok: false };
    }

    const activities = toClosetActivities({
      registeredItems: itemsResult.data ?? [],
      reviewActivities: toReviewActivities({
        aiDiagnoses: aiResult.data ?? [],
        swipeDecisions: swipeResult.data ?? [],
      }),
      wearLogs: wearResult.data ?? [],
    });
    return { ok: true, progress: buildReQuestProgress({ activities, range, now }) };
  } catch (error) {
    console.error("fetchReQuestProgress exception:", error);
    return { ok: false };
  }
}
