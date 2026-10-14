import {
  buildStoryTimeline,
  getJstMonthKey,
  getJstMonthRangeUtc,
  isMonthBeforeTracking,
  isStoryAction,
  isStoryKind,
  resolveMonthEventsLimit,
  resolveStoryMonth,
  STORY_MONTH_EVENTS_LIMIT,
  summarizeStoryMonth,
  type StoryEvent,
  type StoryMonthNav,
  type StoryMonthSummary,
  type StoryTimelineDay,
} from "@/lib/re-story";
import type { SupabaseClient } from "@supabase/supabase-js";

// ============================================================
// Re:Story のデータ取得（closet_activity_events、migration 019）
// - ログイン中のユーザーの行動だけ（RLSに加え、user_id でも明示的に絞る）
// - 取り消し済み（revoked_at）は読まない
// - 表示する月の範囲だけ、必要な列と服の今の名前だけを読む
// - 1か月1000件まで。1001件目の有無（必要なら正確な件数）で上限超過を判定する
// - 取得エラー・上限超過は ok:false（記録0件として表示しない）。例外は投げない
// ============================================================

const EVENT_COLUMNS =
  "id, kind, action, clothing_item_id, occurred_at, revoked_at, clothing_items(title)";

export type StoryPageData = {
  nav: StoryMonthNav;
  /** 行動が1件でもあるか（ない人には始め方を案内する） */
  hasAnyEvents: boolean;
  summary: StoryMonthSummary;
  timeline: StoryTimelineDay[];
  /** 019 適用前で、記録が欠けているかもしれない月か */
  showTrackingNote: boolean;
};

export type StoryPageResult =
  | { ok: true; data: StoryPageData }
  | { ok: false; reason: "load_error" | "over_limit"; nav: StoryMonthNav | null };

type EventRow = {
  id: string;
  kind: unknown;
  action: unknown;
  clothing_item_id: string | null;
  occurred_at: string;
  revoked_at: string | null;
  clothing_items: { title: unknown } | { title: unknown }[] | null;
};

/** DBの行を StoryEvent にする（知らない種類・行動は除く） */
export function toStoryEvents(rows: EventRow[]): StoryEvent[] {
  return rows.flatMap((row) => {
    if (!isStoryKind(row.kind) || !isStoryAction(row.action)) return [];
    const item = Array.isArray(row.clothing_items) ? row.clothing_items[0] : row.clothing_items;
    const title = item && typeof item.title === "string" ? item.title : null;
    return [
      {
        id: row.id,
        kind: row.kind,
        action: row.action,
        clothingItemId: row.clothing_item_id,
        itemTitle: row.clothing_item_id === null ? null : title,
        occurredAt: row.occurred_at,
        revokedAt: row.revoked_at,
      },
    ];
  });
}

export async function fetchStoryPage(
  supabase: SupabaseClient,
  {
    userId,
    requestedMonth,
    photoOnlyTitle,
    now = new Date(),
  }: {
    userId: string;
    requestedMonth: unknown;
    photoOnlyTitle: string;
    now?: Date;
  },
): Promise<StoryPageResult> {
  try {
    // 1. 最初の行動（月の移動範囲）と、行動履歴が作られた時刻（019 の適用時刻）
    const [firstResult, trackingResult] = await Promise.all([
      supabase
        .from("closet_activity_events")
        .select("occurred_at")
        .eq("user_id", userId)
        .is("revoked_at", null)
        .order("occurred_at", { ascending: true })
        .limit(1)
        .maybeSingle(),
      // 初期作成の行の created_at は、019 を適用したときの時刻（同じトランザクションで記録）
      supabase
        .from("closet_activity_events")
        .select("created_at")
        .eq("user_id", userId)
        .eq("detail->>backfilled", "true")
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle(),
    ]);
    if (firstResult.error || trackingResult.error) {
      console.error("fetchStoryPage first event error:", firstResult.error ?? trackingResult.error);
      return { ok: false, reason: "load_error", nav: null };
    }

    const firstOccurredAt: string | null = firstResult.data?.occurred_at ?? null;
    const firstMonthKey = firstOccurredAt ? getJstMonthKey(new Date(firstOccurredAt)) : null;
    const nav = resolveStoryMonth({ requested: requestedMonth, now, firstMonthKey });
    const range = getJstMonthRangeUtc(nav.monthKey);
    const start = range.startUtc.toISOString();
    const end = range.endUtc.toISOString();

    // 2. その月の行動（1001件目まで要求する）
    const monthResult = await supabase
      .from("closet_activity_events")
      .select(EVENT_COLUMNS)
      .eq("user_id", userId)
      .is("revoked_at", null)
      .gte("occurred_at", start)
      .lt("occurred_at", end)
      .order("occurred_at", { ascending: false })
      .order("id", { ascending: true })
      .limit(STORY_MONTH_EVENTS_LIMIT + 1);
    if (monthResult.error || !Array.isArray(monthResult.data)) {
      console.error("fetchStoryPage month error:", monthResult.error);
      return { ok: false, reason: "load_error", nav };
    }

    // Data API の最大件数で1000件に切られた可能性があるときは、正確な件数で確かめる
    let exactCount: number | null = null;
    if (monthResult.data.length >= STORY_MONTH_EVENTS_LIMIT) {
      const countResult = await supabase
        .from("closet_activity_events")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .is("revoked_at", null)
        .gte("occurred_at", start)
        .lt("occurred_at", end);
      exactCount = countResult.error ? null : (countResult.count ?? null);
    }
    if (
      resolveMonthEventsLimit({ rowCount: monthResult.data.length, exactCount }) ===
      "over_limit"
    ) {
      return { ok: false, reason: "over_limit", nav };
    }

    const events = toStoryEvents(monthResult.data as EventRow[]);
    return {
      ok: true,
      data: {
        nav,
        hasAnyEvents: firstOccurredAt !== null,
        summary: summarizeStoryMonth(events),
        timeline: buildStoryTimeline(events, photoOnlyTitle),
        showTrackingNote: isMonthBeforeTracking(
          nav.monthKey,
          trackingResult.data?.created_at ?? null,
        ),
      },
    };
  } catch (error) {
    console.error("fetchStoryPage exception:", error);
    return { ok: false, reason: "load_error", nav: null };
  }
}
