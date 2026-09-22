"use client";

import { updateClothingItemStatus } from "@/app/protected/items/[id]/actions";
import { Button } from "@/components/ui/button";
import { STATUS_OPTIONS } from "@/lib/clothing-options";
import { useState, useTransition } from "react";

type StatusSelectorProps = {
  itemId: string;
  currentStatus: string;
};

export function StatusSelector({
  itemId,
  currentStatus,
}: StatusSelectorProps) {
  const [isPending, startTransition] = useTransition();
  const [pendingStatus, setPendingStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSelect = (status: string) => {
    if (status === currentStatus || isPending) return;
    setError(null);
    setPendingStatus(status);
    startTransition(async () => {
      const result = await updateClothingItemStatus(itemId, status);
      if (result.error) {
        setError(result.error);
      }
      setPendingStatus(null);
    });
  };

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm font-medium">この服、どうする？</p>
      <div className="grid grid-cols-2 gap-2">
        {STATUS_OPTIONS.map((option) => {
          const isCurrent = option.value === currentStatus;
          return (
            <Button
              key={option.value}
              type="button"
              variant={isCurrent ? "default" : "outline"}
              disabled={isCurrent || isPending}
              onClick={() => handleSelect(option.value)}
            >
              {isPending && pendingStatus === option.value
                ? "更新中..."
                : option.label}
            </Button>
          );
        })}
      </div>
      {error && <p className="text-sm text-red-500">{error}</p>}
    </div>
  );
}
