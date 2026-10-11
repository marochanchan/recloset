"use client";

import { Button } from "@/components/ui/button";
import { deleteClothingDraft } from "@/lib/clothing-drafts";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

// 下書き一覧の「削除」（確認してから、DBの行→写真の順に削除する）
export function ClothingDraftDeleteButton({ draftId }: { draftId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleDelete = () => {
    if (!window.confirm("この下書きを削除しますか？（写真も削除されます）")) {
      return;
    }
    setError(null);
    startTransition(async () => {
      const ok = await deleteClothingDraft({
        supabase: createClient(),
        draftId,
      });
      if (!ok) {
        setError("削除できませんでした。もう一度お試しください");
        return;
      }
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={handleDelete}
        disabled={isPending}
      >
        {isPending ? "削除中..." : "削除"}
      </Button>
      {error && <p className="text-xs text-red-500">{error}</p>}
    </div>
  );
}
