import {
  ClosetReviewSession,
  type ReviewSessionDecisionRow,
  type ReviewSessionItem,
} from "@/components/closet-review-session";
import { ClosetReviewUndoLastButton } from "@/components/closet-review-undo-last-button";
import { ReviewSessionSkeleton } from "@/components/loading-skeletons";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  isReviewSessionDecision,
  isReviewSessionStatus,
  REVIEW_SESSION_DECISION_LABELS,
  summarizeReviewDecisions,
} from "@/lib/closet-review";
import { PHOTO_ONLY_TITLE } from "@/lib/clothing-options";
import { getCurrentClaims } from "@/lib/supabase/current-user";
import { createClient } from "@/lib/supabase/server";
import { getPrivateSignedImageUrls } from "@/lib/supabase/signed-image-urls";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

export const metadata: Metadata = {
  title: "まとめて見直す | Re:Closet",
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type SessionItemRow = {
  id: string;
  title: string;
  status: string;
  imageUrl: string | null;
};

// 本人のセッション・判断・服（RLSにより本人の行だけが返る）
async function loadSession(sessionId: string) {
  const supabase = await createClient();
  const { data: session, error } = await supabase
    .from("closet_review_sessions")
    .select("id, item_ids, completed_at")
    .eq("id", sessionId)
    .maybeSingle();
  if (error) throw error;
  if (!session) notFound();

  const itemIds: string[] = Array.isArray(session.item_ids)
    ? session.item_ids
    : [];
  const [decisionsResult, itemsResult] = await Promise.all([
    supabase
      .from("closet_review_decisions")
      .select("id, clothing_item_id, decision")
      .eq("session_id", sessionId)
      .order("created_at", { ascending: true }),
    supabase
      .from("clothing_items")
      .select("id, title, status, clothing_images(image_path, sort_order)")
      .in("id", itemIds),
  ]);
  if (decisionsResult.error) throw decisionsResult.error;
  if (itemsResult.error) throw itemsResult.error;

  // 服ごとの代表画像（sort_orderが最小の1枚）
  const coverPathByItem = new Map<string, string>();
  for (const item of itemsResult.data) {
    const cover = [...(item.clothing_images ?? [])].sort(
      (a, b) => a.sort_order - b.sort_order,
    )[0];
    if (cover) coverPathByItem.set(item.id, cover.image_path);
  }
  const claims = await getCurrentClaims();
  const urlByPath = await getPrivateSignedImageUrls(
    supabase,
    claims?.sub,
    [...coverPathByItem.values()],
    "review session",
  );

  const itemById = new Map<string, SessionItemRow>();
  for (const item of itemsResult.data) {
    const coverPath = coverPathByItem.get(item.id);
    itemById.set(item.id, {
      id: item.id,
      title: item.title,
      status: item.status,
      imageUrl: coverPath ? (urlByPath.get(coverPath) ?? null) : null,
    });
  }

  const decisions: ReviewSessionDecisionRow[] = decisionsResult.data
    .filter((row) => isReviewSessionDecision(row.decision))
    .map((row) => ({
      id: row.id,
      itemId: row.clothing_item_id,
      decision: row.decision,
    }));

  return { session, itemIds, itemById, decisions };
}

async function ReviewSessionContent({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  if (!UUID_PATTERN.test(sessionId)) notFound();

  const { session, itemIds, itemById, decisions } = await loadSession(sessionId);

  if (session.completed_at) {
    // 「最後の判断をやり直す」は、最新のセッション（＝ほかに途中の見直しがない）で、
    // 最後に判断した服がまだ見直せる状態のときだけ出す
    // （出品中・売却済みになった服は、戻しても見直し画面に出ないため）
    const lastDecision = decisions.at(-1);
    const lastItem = lastDecision ? itemById.get(lastDecision.itemId) : undefined;
    let undoLastDecisionId: string | null = null;
    if (lastDecision && lastItem && isReviewSessionStatus(lastItem.status)) {
      const supabase = await createClient();
      const { data: latest, error: latestError } = await supabase
        .from("closet_review_sessions")
        .select("id")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (latestError) {
        console.error("latest review session error:", latestError);
      } else if (latest?.id === session.id) {
        undoLastDecisionId = lastDecision.id;
      }
    }
    return (
      <ReviewResult
        sessionId={session.id}
        itemById={itemById}
        decisions={decisions}
        undoLastDecisionId={undoLastDecisionId}
      />
    );
  }

  // 見せる服: 判断済みの服（1つ前に戻すため）と、まだ見直せる状態の服。
  // 削除された服・出品中や売却済みになった未判断の服は出さない
  const decidedIds = new Set(decisions.map((decision) => decision.itemId));
  const items: ReviewSessionItem[] = itemIds.flatMap((id) => {
    const item = itemById.get(id);
    if (!item) return [];
    if (!decidedIds.has(id) && !isReviewSessionStatus(item.status)) return [];
    return [{ id: item.id, title: item.title, imageUrl: item.imageUrl }];
  });
  const visibleIds = new Set(items.map((item) => item.id));

  return (
    <ClosetReviewSession
      sessionId={session.id}
      items={items}
      initialDecisions={decisions.filter((decision) =>
        visibleIds.has(decision.itemId),
      )}
    />
  );
}

// 結果。手放した数だけを成果にせず、見直したこと自体を伝える
function ReviewResult({
  sessionId,
  itemById,
  decisions,
  undoLastDecisionId,
}: {
  sessionId: string;
  itemById: Map<string, SessionItemRow>;
  decisions: ReviewSessionDecisionRow[];
  /** 「最後の判断をやり直す」の対象（出さないときはnull） */
  undoLastDecisionId: string | null;
}) {
  const summary = summarizeReviewDecisions(decisions);
  const itemsOf = (decision: "unsure" | "let_go_candidate") =>
    decisions
      .filter((row) => row.decision === decision)
      .flatMap((row) => {
        const item = itemById.get(row.itemId);
        return item ? [item] : [];
      });
  const unsureItems = itemsOf("unsure");
  const letGoItems = itemsOf("let_go_candidate");

  const breakdown = [
    { label: REVIEW_SESSION_DECISION_LABELS.keep, count: summary.keep },
    { label: REVIEW_SESSION_DECISION_LABELS.unsure, count: summary.unsure },
    {
      label: REVIEW_SESSION_DECISION_LABELS.let_go_candidate,
      count: summary.letGoCandidate,
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <Card className="flex flex-col gap-4 p-5 text-center">
        <div className="flex flex-col gap-1">
          <p className="text-lg font-bold">見直しおつかれさまでした</p>
          <p className="text-sm text-muted-foreground">
            {summary.reviewed > 0
              ? `${summary.reviewed}着を見直しました。1着ずつ向き合えたことが、クローゼットを整える一歩です。`
              : "今回はスキップしました。またいつでも見直せます。"}
          </p>
        </div>
        <dl className="grid grid-cols-3 gap-2">
          {breakdown.map(({ label, count }) => (
            <div key={label} className="rounded-xl bg-secondary/60 px-2 py-3">
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="text-xl font-bold">{count}</dd>
            </div>
          ))}
        </dl>
        {summary.skip > 0 && (
          <p className="text-xs text-muted-foreground">
            スキップ {summary.skip}着（見直した着数には含めていません）
          </p>
        )}
        {undoLastDecisionId && (
          <ClosetReviewUndoLastButton
            sessionId={sessionId}
            lastDecisionId={undoLastDecisionId}
          />
        )}
      </Card>

      <ResultItemList
        title="迷った服"
        description="急がなくて大丈夫です。着てみる・AIと一緒に考えるなど、詳細ページから続けられます。"
        items={unsureItems}
      />
      <ResultItemList
        title="手放し候補にした服"
        description="服の状態は変わっていません。決めたときに、詳細ページから状態を変えられます。"
        items={letGoItems}
      />

      <div className="flex flex-col gap-2">
        <Button asChild>
          <Link href="/protected/items">クローゼットに戻る</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/protected/review">ほかの服も見直す</Link>
        </Button>
      </div>
    </div>
  );
}

function ResultItemList({
  title,
  description,
  items,
}: {
  title: string;
  description: string;
  items: SessionItemRow[];
}) {
  if (items.length === 0) return null;
  return (
    <section className="flex flex-col gap-2">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <ul className="flex flex-col gap-2">
        {items.map((item) => (
          <li key={item.id}>
            <Link
              href={`/protected/items/${item.id}`}
              className="flex items-center gap-3 rounded-lg border p-2 transition-colors hover:bg-accent"
            >
              <span className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-photo">
                {item.imageUrl ? (
                  <Image
                    src={item.imageUrl}
                    alt=""
                    fill
                    sizes="56px"
                    className="object-contain"
                    style={{ objectFit: "contain" }}
                  />
                ) : (
                  <span className="flex h-full items-center justify-center text-[10px] text-muted-foreground">
                    写真なし
                  </span>
                )}
              </span>
              <span
                className={
                  item.title === PHOTO_ONLY_TITLE
                    ? "min-w-0 flex-1 truncate text-sm text-muted-foreground"
                    : "min-w-0 flex-1 truncate text-sm font-medium"
                }
              >
                {item.title}
              </span>
              <span className="text-xs text-muted-foreground">詳細 →</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function ClosetReviewSessionPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  return (
    <div className="w-full max-w-md mx-auto flex flex-col gap-4">
      <Link
        href="/protected/items"
        className="text-sm underline underline-offset-4 text-muted-foreground w-fit"
      >
        ← クローゼットに戻る
      </Link>
      <h1 className="text-2xl font-bold">まとめて見直す</h1>
      <Suspense fallback={<ReviewSessionSkeleton />}>
        <ReviewSessionContent params={params} />
      </Suspense>
    </div>
  );
}
