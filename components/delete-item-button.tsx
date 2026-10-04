"use client";

import { deleteClothingItem } from "@/app/protected/items/[id]/actions";
import { Button } from "@/components/ui/button";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

type DeleteItemButtonProps = {
  itemId: string;
};

export function DeleteItemButton({ itemId }: DeleteItemButtonProps) {
  const [isConfirming, setIsConfirming] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const handleDelete = () => {
    setError(null);
    startTransition(async () => {
      const result = await deleteClothingItem(itemId);
      if (result.error) {
        setError(result.error);
        return;
      }
      router.push("/protected/items");
    });
  };

  if (!isConfirming) {
    return (
      <Button
        type="button"
        variant="destructive"
        className="w-full"
        onClick={() => setIsConfirming(true)}
      >
        削除する
      </Button>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-destructive/50 p-3">
      <p className="text-sm text-destructive">
        この服を削除します。画像・着用記録も含めて元に戻せません。本当に削除しますか？
      </p>
      <div className="flex gap-2">
        <Button
          type="button"
          variant="destructive"
          className="flex-1"
          disabled={isPending}
          onClick={handleDelete}
        >
          {isPending ? "削除中..." : "本当に削除する"}
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
      {error && <p className="text-sm text-red-500">{error}</p>}
    </div>
  );
}
