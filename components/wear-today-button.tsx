"use client";

import { recordWearToday } from "@/app/protected/items/[id]/actions";
import { Button } from "@/components/ui/button";
import { useState, useTransition } from "react";

type WearTodayButtonProps = {
  itemId: string;
  alreadyLoggedToday: boolean;
  /** compact: トップの「今日のコーデ候補」用の小さいボタン */
  variant?: "default" | "compact";
};

export function WearTodayButton({
  itemId,
  alreadyLoggedToday,
  variant = "default",
}: WearTodayButtonProps) {
  const isCompact = variant === "compact";

  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (alreadyLoggedToday) {
    return (
      <Button
        type="button"
        size={isCompact ? "sm" : "default"}
        variant={isCompact ? "outline" : "default"}
        className={isCompact ? "w-fit" : "w-full"}
        disabled
      >
        今日は着用済み ✓
      </Button>
    );
  }

  const handleClick = () => {
    setError(null);
    startTransition(async () => {
      const result = await recordWearToday(itemId);
      if (result.error) {
        setError(result.error);
      }
    });
  };

  return (
    <div className="flex flex-col gap-2">
      <Button
        type="button"
        size={isCompact ? "sm" : "default"}
        variant={isCompact ? "outline" : "default"}
        className={isCompact ? "w-fit" : "w-full"}
        onClick={handleClick}
        disabled={isPending}
      >
        {isPending ? "記録中..." : isCompact ? "今日これを着る" : "今日着た"}
      </Button>
      {error && (
        <p
          className={
            isCompact ? "text-xs text-red-500" : "text-sm text-red-500"
          }
        >
          {error}
        </p>
      )}
    </div>
  );
}
