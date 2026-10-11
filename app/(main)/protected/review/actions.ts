"use server";

import {
  REVIEW_SESSION_STATUSES,
  selectReviewSessionItems,
} from "@/lib/closet-review";
import type { ReviewDecision, ReviewItemInput } from "@/lib/review-suggestions";
import { createClient } from "@/lib/supabase/server";
import { getJstDateKey } from "@/lib/weather";
import { redirect } from "next/navigation";

// 選定に読む件数の上限（Closetの「今日見直す3着」と同じ）
const REVIEW_ITEMS_LIMIT = 1000;
const REVIEW_DIAGNOSES_LIMIT = 2000;
const REVIEW_DECISIONS_LIMIT = 5000;

type StartClosetReviewResult = { error: string };

/** 本人の未完了のセッション（1人1つまで。DBの部分UNIQUEで保証） */
async function findOpenSessionId(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("closet_review_sessions")
    .select("id")
    .is("completed_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error("find open review session error:", error);
    return null;
  }
  return data?.id ?? null;
}

/**
 * 見直しセッションを始める（未完了のセッションがあれば、それを再開する）。
 * 成功したらセッションの画面へ移動する。服の情報は変更しない。AIは使わない。
 */
export async function startClosetReview(): Promise<StartClosetReviewResult> {
  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  if (!claimsData?.claims?.sub) {
    return { error: "ログイン情報が確認できませんでした" };
  }

  const openSessionId = await findOpenSessionId(supabase);
  if (openSessionId) {
    redirect(`/protected/review/${openSessionId}`);
  }

  const [itemsResult, diagnosesResult, decisionsResult] = await Promise.all([
    supabase
      .from("clothing_items")
      .select("id, title, status, seasons, favorite, last_worn_at, purchase_date")
      .in("status", [...REVIEW_SESSION_STATUSES])
      .order("created_at", { ascending: true })
      .limit(REVIEW_ITEMS_LIMIT),
    // 新しい順に読み、服ごとに最初の1件を最新の診断として使う
    supabase
      .from("ai_diagnoses")
      .select("clothing_item_id, decision, created_at")
      .order("created_at", { ascending: false })
      .limit(REVIEW_DIAGNOSES_LIMIT),
    // 服ごとの最後の見直し（スキップは見直したことに数えない）
    supabase
      .from("closet_review_decisions")
      .select("clothing_item_id, created_at")
      .neq("decision", "skip")
      .order("created_at", { ascending: false })
      .limit(REVIEW_DECISIONS_LIMIT),
  ]);

  if (itemsResult.error || diagnosesResult.error || decisionsResult.error) {
    console.error(
      "start review session fetch error:",
      itemsResult.error ?? diagnosesResult.error ?? decisionsResult.error,
    );
    return { error: "服の情報を読み込めませんでした。時間をおいてお試しください" };
  }

  const latestDiagnosisByItem = new Map<
    string,
    { decision: ReviewDecision; createdAt: string }
  >();
  for (const diagnosis of diagnosesResult.data) {
    if (!latestDiagnosisByItem.has(diagnosis.clothing_item_id)) {
      latestDiagnosisByItem.set(diagnosis.clothing_item_id, {
        decision: diagnosis.decision as ReviewDecision,
        createdAt: diagnosis.created_at,
      });
    }
  }

  const lastReviewedAtByItem = new Map<string, string>();
  for (const decision of decisionsResult.data) {
    if (!lastReviewedAtByItem.has(decision.clothing_item_id)) {
      lastReviewedAtByItem.set(decision.clothing_item_id, decision.created_at);
    }
  }

  const items: ReviewItemInput[] = itemsResult.data.map((item) => ({
    id: item.id,
    title: item.title,
    status: item.status,
    seasons: item.seasons ?? [],
    favorite: item.favorite,
    lastWornAt: item.last_worn_at,
    purchaseDate: item.purchase_date ?? null,
    latestDiagnosis: latestDiagnosisByItem.get(item.id) ?? null,
  }));

  const now = new Date();
  const itemIds = selectReviewSessionItems({
    items,
    lastReviewedAtByItem,
    now,
    dateKey: getJstDateKey(now),
  });
  if (itemIds.length === 0) {
    return { error: "見直せる服がありません。まずは服を登録してみましょう" };
  }

  const { data: session, error: insertError } = await supabase
    .from("closet_review_sessions")
    .insert({ item_ids: itemIds })
    .select("id")
    .single();

  if (insertError?.code === "23505") {
    // 別のタブなどで同時に始めた場合。既存の未完了セッションを再開する
    const existingId = await findOpenSessionId(supabase);
    if (existingId) redirect(`/protected/review/${existingId}`);
  }
  if (insertError || !session) {
    console.error("create review session error:", insertError);
    return { error: "見直しを始められませんでした。時間をおいてお試しください" };
  }

  redirect(`/protected/review/${session.id}`);
}
