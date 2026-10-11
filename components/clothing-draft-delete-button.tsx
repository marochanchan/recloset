"use client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { deleteClothingDraft } from "@/lib/clothing-drafts";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLayoutEffect, useRef, useState, useTransition } from "react";

// 下書き一覧の1件（写真・文字は children）。「削除」は服の削除（DeleteItemButton）と
// 同じく、カードの中に確認を出してから、DBの行→写真の順に削除する
export function ClothingDraftCard({
  draftId,
  children,
}: {
  draftId: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [isConfirming, setIsConfirming] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // 二重削除の防止。isPendingは次の描画まで反映されないため、refを併用する
  const deletingRef = useRef(false);

  // cacheComponents の <Activity> で一覧が残ったまま再表示されたとき、
  // 確認を開いたままにしない
  useLayoutEffect(() => {
    return () => {
      setIsConfirming(false);
      setError(null);
    };
  }, []);

  const handleDelete = () => {
    if (deletingRef.current) return;
    deletingRef.current = true;
    setError(null);
    startTransition(async () => {
      const ok = await deleteClothingDraft({
        supabase: createClient(),
        draftId,
      });
      if (!ok) {
        deletingRef.current = false;
        setError("削除できませんでした。もう一度お試しください");
        return;
      }
      router.refresh();
    });
  };

  return (
    <Card className="flex flex-col gap-3 p-3">
      <div className="flex items-center gap-3">
        {children}
        <div className="flex shrink-0 flex-col items-end gap-1">
          <Button asChild size="sm">
            <Link href={`/protected/items/new?draft=${draftId}`}>
              続きから入力
            </Link>
          </Button>
          {!isConfirming && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setIsConfirming(true)}
            >
              削除
            </Button>
          )}
        </div>
      </div>

      {isConfirming && (
        <div className="flex flex-col gap-2 rounded-md border border-destructive/50 p-3">
          <p className="text-sm font-medium text-destructive">
            この下書きを削除しますか？
          </p>
          <p className="text-sm text-muted-foreground">
            保存した入力内容と写真も削除されます。この操作は取り消せません。
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="destructive"
              className="flex-1"
              disabled={isPending}
              onClick={handleDelete}
            >
              {isPending ? "削除中..." : "削除する"}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              disabled={isPending}
              onClick={() => {
                setError(null);
                setIsConfirming(false);
              }}
            >
              キャンセル
            </Button>
          </div>
          {error && <p className="text-sm text-red-500">{error}</p>}
        </div>
      )}
    </Card>
  );
}
