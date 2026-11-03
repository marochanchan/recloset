"use client";

import { deleteOutfitAction } from "@/app/(main)/protected/looks/actions";
import { Button } from "@/components/ui/button";
import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

// 着画の削除。服の削除（DeleteItemButton）と同じく、ふだんは控えめにして、確認を出してから消す
export function DeleteLookButton({ outfitId }: { outfitId: string }) {
  const [isConfirming, setIsConfirming] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const handleDelete = () => {
    setError(null);
    startTransition(async () => {
      try {
        const result = await deleteOutfitAction({ outfitId });
        if ("error" in result) {
          setError(result.error);
          return;
        }
        router.push("/protected/looks");
      } catch {
        setError("うまく進められませんでした。時間をおいて、もう一度お試しください");
      }
    });
  };

  if (!isConfirming) {
    return (
      <Button
        type="button"
        variant="ghost"
        className="w-full text-destructive hover:bg-destructive/10 hover:text-destructive"
        onClick={() => setIsConfirming(true)}
      >
        <Trash2 aria-hidden="true" />
        この着画を消す
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-destructive/40 bg-destructive/5 p-4">
      <p className="text-sm text-destructive">
        写真と記録を消します。元に戻せません。
      </p>
      <div className="flex gap-2">
        <Button
          type="button"
          variant="destructive"
          className="flex-1"
          disabled={isPending}
          onClick={handleDelete}
        >
          {isPending ? "消しています..." : "本当に消す"}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="flex-1"
          disabled={isPending}
          onClick={() => setIsConfirming(false)}
        >
          キャンセル
        </Button>
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </div>
  );
}
