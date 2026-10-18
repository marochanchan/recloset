"use client";

import { Button } from "@/components/ui/button";
import {
  REVIEW_SESSION_DECISION_LABELS,
  type ReviewSessionDecision,
} from "@/lib/closet-review";
import { PHOTO_ONLY_TITLE } from "@/lib/clothing-options";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { Undo2 } from "lucide-react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

// ============================================================
// スワイプ式の見直し（1着ずつ写真を大きく見せて判断する）。
// - 右スワイプ＝残す、左スワイプ＝迷う。4つのボタンでも同じ操作ができる
// - 判断は closet_review_decisions に保存するだけ（服の status は変えない）
// - 1つ前に戻す: 直前の判断の行を削除して、その服に戻る
// - 最後の服まで進んだらセッションを完了にし、サーバーで結果を表示する
// - 縦スクロールはブラウザに任せ（touch-action: pan-y）、横の動きだけをスワイプにする
// ============================================================

export type ReviewSessionItem = {
  id: string;
  title: string;
  imageUrl: string | null;
};

export type ReviewSessionDecisionRow = {
  id: string;
  itemId: string;
  decision: ReviewSessionDecision;
};

// これ以上横に動かして離したら判断する（px）
const SWIPE_THRESHOLD = 80;
// 指を置いてから、横の動きとしてカードを動かし始める距離（px）
const DRAG_START_DISTANCE = 8;

export function ClosetReviewSession({
  sessionId,
  items,
  initialDecisions,
}: {
  sessionId: string;
  /** セッションの服（見せる順） */
  items: ReviewSessionItem[];
  /** これまでの判断（古い順） */
  initialDecisions: ReviewSessionDecisionRow[];
}) {
  const router = useRouter();
  const [decisions, setDecisions] = useState(initialDecisions);
  const [isBusy, setIsBusy] = useState(false);
  // 二重送信の防止。stateは次の描画まで反映されないため、refを併用する
  const busyRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [completeFailed, setCompleteFailed] = useState(false);

  const decidedIds = new Set(decisions.map((decision) => decision.itemId));
  const remaining = items.filter((item) => !decidedIds.has(item.id));
  const current = remaining[0] ?? null;

  // 最後まで進んだら、セッションを完了にして結果を表示する
  // （別のタブで完了済みなら更新は0件になり、そのまま結果を表示する）
  const completeSession = async () => {
    setCompleteFailed(false);
    try {
      const { error: updateError } = await createClient()
        .from("closet_review_sessions")
        .update({ completed_at: new Date().toISOString() })
        .eq("id", sessionId)
        .is("completed_at", null);
      if (updateError) throw updateError;
    } catch (updateError) {
      // 通信エラーなどで例外になった場合も、再試行できるようにする
      console.error("complete review session error:", updateError);
      setCompleteFailed(true);
      return false;
    }
    router.refresh();
    return true;
  };

  // 再開した時点で残りがない（服が削除・売却された等）ときも完了にする
  const completeStartedRef = useRef(false);
  useEffect(() => {
    if (current || completeStartedRef.current) return;
    completeStartedRef.current = true;
    busyRef.current = true;
    setIsBusy(true);
    void completeSession().then((ok) => {
      if (!ok) {
        completeStartedRef.current = false;
        busyRef.current = false;
        setIsBusy(false);
      }
    });
    // 残りがなくなったときだけ判定する
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current]);

  const decide = async (decision: ReviewSessionDecision) => {
    if (!current || busyRef.current) return;
    busyRef.current = true;
    setIsBusy(true);
    setError(null);
    const item = current;
    try {
      const supabase = createClient();
      const { data, error: insertError } = await supabase
        .from("closet_review_decisions")
        .insert({
          session_id: sessionId,
          clothing_item_id: item.id,
          decision,
        })
        .select("id, decision")
        .single();

      let saved = data;
      if (insertError?.code === "23505") {
        // 別のタブなどで、この服の判断が先に保存されていた。保存済みの判断を使う
        const { data: existing } = await supabase
          .from("closet_review_decisions")
          .select("id, decision")
          .eq("session_id", sessionId)
          .eq("clothing_item_id", item.id)
          .maybeSingle();
        saved = existing;
      }
      if (!saved) {
        if (insertError) console.error("save review decision error:", insertError);
        setError("保存できませんでした。もう一度お試しください");
        return;
      }
      setDecisions((prev) => [
        ...prev,
        {
          id: saved.id,
          itemId: item.id,
          decision: saved.decision as ReviewSessionDecision,
        },
      ]);
    } catch (saveError) {
      // 通信エラーなどの例外。同じ服のまま、もう一度選べる
      console.error("save review decision error:", saveError);
      setError("保存できませんでした。もう一度お試しください");
    } finally {
      busyRef.current = false;
      setIsBusy(false);
    }
  };

  const undo = async () => {
    const last = decisions.at(-1);
    if (!last || busyRef.current) return;
    busyRef.current = true;
    setIsBusy(true);
    setError(null);
    try {
      const { error: deleteError } = await createClient()
        .from("closet_review_decisions")
        .delete()
        .eq("id", last.id);
      if (deleteError) {
        console.error("undo review decision error:", deleteError);
        setError("戻せませんでした。もう一度お試しください");
        return;
      }
      setDecisions((prev) => prev.filter((decision) => decision.id !== last.id));
    } catch (deleteError) {
      console.error("undo review decision error:", deleteError);
      setError("戻せませんでした。もう一度お試しください");
    } finally {
      busyRef.current = false;
      setIsBusy(false);
    }
  };

  // ---- スワイプ ----
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    isHorizontal: boolean;
  } | null>(null);
  const [dragX, setDragX] = useState(0);

  const resetDrag = () => {
    dragRef.current = null;
    setDragX(0);
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (isBusy || !current) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      isHorizontal: false,
    };
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.isHorizontal) {
      if (Math.abs(dx) < DRAG_START_DISTANCE) return;
      // 縦の動きが大きいときはスワイプにしない（スクロールに任せる）
      if (Math.abs(dy) > Math.abs(dx)) {
        resetDrag();
        return;
      }
      drag.isHorizontal = true;
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    setDragX(dx);
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = drag.isHorizontal ? event.clientX - drag.startX : 0;
    resetDrag();
    if (dx >= SWIPE_THRESHOLD) void decide("keep");
    else if (dx <= -SWIPE_THRESHOLD) void decide("unsure");
  };

  const total = items.length;
  const position = Math.min(decisions.length + 1, total);
  const swipeStrength = Math.min(Math.abs(dragX) / SWIPE_THRESHOLD, 1);

  if (!current) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl bg-secondary/60 px-6 py-12 text-center">
        {completeFailed ? (
          <>
            <p className="text-sm text-destructive">
              結果を保存できませんでした。判断はすべて保存されています
            </p>
            <Button
              type="button"
              onClick={() => void completeSession()}
            >
              結果を表示する
            </Button>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">結果をまとめています…</p>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium" aria-live="polite">
          {position} / {total}着
        </p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={undo}
          disabled={isBusy || decisions.length === 0}
        >
          <Undo2 className="h-4 w-4" aria-hidden="true" />
          1つ前に戻す
        </Button>
      </div>
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-secondary"
        aria-hidden="true"
      >
        <div
          className="h-full bg-primary transition-[width]"
          style={{ width: `${(decisions.length / total) * 100}%` }}
        />
      </div>

      {/* 写真のカード。横の動きだけをスワイプとして受け取る */}
      <div
        className="relative touch-pan-y select-none"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={resetDrag}
      >
        <div
          className={cn(
            "overflow-hidden rounded-3xl border border-border/60 bg-card shadow-sm",
            dragX === 0 && "transition-transform duration-150",
            isBusy && "opacity-70",
          )}
          style={{
            transform: `translateX(${dragX}px) rotate(${dragX / 30}deg)`,
          }}
        >
          <div className="relative aspect-[4/5] max-h-[60vh] w-full bg-photo">
            {current.imageUrl ? (
              <Image
                key={current.id}
                src={current.imageUrl}
                alt={current.title}
                fill
                priority
                draggable={false}
                sizes="(min-width: 640px) 28rem, 100vw"
                className="pointer-events-none object-contain"
                style={{ objectFit: "contain" }}
              />
            ) : (
              <span className="flex h-full items-center justify-center text-sm text-muted-foreground">
                写真なし
              </span>
            )}
            {/* スワイプ中の方向と判断 */}
            {dragX !== 0 && (
              <span
                className={cn(
                  "absolute top-4 rounded-lg border-2 bg-card/90 px-3 py-1 text-lg font-semibold",
                  dragX > 0
                    ? "left-4 border-primary text-primary"
                    : "right-4 border-muted-foreground text-muted-foreground",
                )}
                style={{ opacity: swipeStrength }}
                aria-hidden="true"
              >
                {dragX > 0 ? "残す" : "迷う"}
              </span>
            )}
          </div>
          <p
            className={cn(
              "truncate px-4 py-3",
              current.title === PHOTO_ONLY_TITLE
                ? "text-sm text-muted-foreground"
                : "font-medium",
            )}
          >
            {current.title}
          </p>
        </div>
      </div>
      <p className="text-center text-xs text-muted-foreground">
        ← 迷う ・ 残す → （スワイプかボタンで選べます）
      </p>

      <div className="grid grid-cols-2 gap-2">
        <Button
          type="button"
          variant="outline"
          size="lg"
          onClick={() => decide("unsure")}
          disabled={isBusy}
        >
          ← {REVIEW_SESSION_DECISION_LABELS.unsure}
        </Button>
        <Button
          type="button"
          size="lg"
          onClick={() => decide("keep")}
          disabled={isBusy}
        >
          {REVIEW_SESSION_DECISION_LABELS.keep} →
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => decide("let_go_candidate")}
          disabled={isBusy}
        >
          {REVIEW_SESSION_DECISION_LABELS.let_go_candidate}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => decide("skip")}
          disabled={isBusy}
        >
          {REVIEW_SESSION_DECISION_LABELS.skip}
        </Button>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <p className="text-xs text-muted-foreground">
        判断は記録として残すだけです。服の状態は変わりません。途中でやめても、続きから再開できます。
      </p>
    </div>
  );
}
