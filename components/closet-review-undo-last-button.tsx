"use client";

import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { Undo2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

// 結果画面の「最後の判断をやり直す」。セッションを未完了に戻してから、
// 最後の判断の行を削除し、その服の見直し画面に戻る。
// - 未完了に戻すのを先にする。判断の削除だけが失敗しても、全員判断済みの
//   未完了セッションとして開かれ、自動で完了し直す（結果は元に戻るだけ）
// - 未完了のセッションは1人1つまで（DBの部分UNIQUE）のため、ほかに途中の
//   見直しがあると戻せない（このボタンは最新のセッションにだけ出す）
export function ClosetReviewUndoLastButton({
  sessionId,
  lastDecisionId,
}: {
  sessionId: string;
  lastDecisionId: string;
}) {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);
  // 二重実行の防止。stateは次の描画まで反映されないため、refを併用する
  const pendingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);

  const handleUndo = async () => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setIsPending(true);
    setError(null);
    try {
      const supabase = createClient();
      const { error: reopenError } = await supabase
        .from("closet_review_sessions")
        .update({ completed_at: null })
        .eq("id", sessionId);
      if (reopenError) {
        throw reopenError.code === "23505"
          ? new Error("ほかに途中の見直しがあるため、やり直せません")
          : reopenError;
      }

      const { error: deleteError } = await supabase
        .from("closet_review_decisions")
        .delete()
        .eq("id", lastDecisionId)
        .eq("session_id", sessionId);
      if (deleteError) throw deleteError;

      // サーバーで読み直すと、未完了のセッションとしてその服から表示される
      router.refresh();
    } catch (undoError) {
      console.error("undo last review decision error:", undoError);
      setError(
        undoError instanceof Error &&
          undoError.message.startsWith("ほかに途中の見直し")
          ? undoError.message
          : "やり直せませんでした。もう一度お試しください",
      );
      // 未完了に戻ってから削除に失敗した場合も、読み直せば結果に戻る
      router.refresh();
      pendingRef.current = false;
      setIsPending(false);
    }
  };

  return (
    <div className="flex flex-col items-center gap-1">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={handleUndo}
        disabled={isPending}
      >
        <Undo2 className="h-4 w-4" aria-hidden="true" />
        {isPending ? "戻しています..." : "最後の判断をやり直す"}
      </Button>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
