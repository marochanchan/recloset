"use client";

import { recordWearToday } from "@/app/protected/items/[id]/actions";
import { Button } from "@/components/ui/button";
import { useState, useTransition } from "react";

type WearTodayButtonProps = {
  itemId: string;
  alreadyLoggedToday: boolean;
};

export function WearTodayButton({
  itemId,
  alreadyLoggedToday,
}: WearTodayButtonProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (alreadyLoggedToday) {
    return (
      <Button type="button" className="w-full" disabled>
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
        className="w-full"
        onClick={handleClick}
        disabled={isPending}
      >
        {isPending ? "記録中..." : "今日着た"}
      </Button>
      {error && <p className="text-sm text-red-500">{error}</p>}
    </div>
  );
}
