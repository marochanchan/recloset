"use client";

import { startClosetReview } from "@/app/(main)/protected/review/actions";
import { Button } from "@/components/ui/button";
import { useState, useTransition } from "react";

// 見直しセッションを始める（未完了のセッションがあれば、それを再開する）。
// 開始はボタンを押したときだけ（ページを開いただけではセッションを作らない）
export function StartClosetReviewButton({ label }: { label: string }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-2">
      <Button
        type="button"
        size="lg"
        className="w-full"
        disabled={isPending}
        onClick={() => {
          setError(null);
          startTransition(async () => {
            // 成功したらサーバー側でセッションの画面へ移動する
            const result = await startClosetReview();
            if (result?.error) setError(result.error);
          });
        }}
      >
        {isPending ? "準備しています..." : label}
      </Button>
      {error && <p className="text-sm text-red-500">{error}</p>}
    </div>
  );
}
