"use client";

import { recordWearToday } from "@/app/(main)/protected/items/[id]/actions";
import { Button } from "@/components/ui/button";
import { useState, useTransition } from "react";

type WearTodayButtonProps = {
  itemId: string;
  alreadyLoggedToday: boolean;
  /**
   * default: 服詳細（「今日着た」だけ）
   * plan: Todayの提案カード（「これにする」→「今日着た」の2段階）
   */
  variant?: "default" | "plan";
};

// 着用記録（wear_logs）は「実際に着た」ときだけ作る。
// Todayの「これにする」は今日着ようと思う服の選択で、記録はしない
// （選択はこの画面のstateだけ。リロードすると消える。将来のコーデ保存の入口）。
export function WearTodayButton({
  itemId,
  alreadyLoggedToday,
  variant = "default",
}: WearTodayButtonProps) {
  const isPlan = variant === "plan";

  const [isChosen, setIsChosen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  if (alreadyLoggedToday) {
    return (
      <Button
        type="button"
        size={isPlan ? "sm" : "default"}
        variant={isPlan ? "outline" : "default"}
        className={isPlan ? "w-fit" : "w-full"}
        disabled
      >
        今日着ました ✓
      </Button>
    );
  }

  const handleWear = () => {
    setError(null);
    startTransition(async () => {
      const result = await recordWearToday(itemId);
      if (result.error) {
        setError(result.error);
      }
    });
  };

  const errorMessage = error && (
    <p className={isPlan ? "text-xs text-red-500" : "text-sm text-red-500"}>
      {error}
    </p>
  );

  if (!isPlan) {
    return (
      <div className="flex flex-col gap-2">
        <Button
          type="button"
          className="w-full"
          onClick={handleWear}
          disabled={isPending}
        >
          {isPending ? "記録中..." : "今日着た"}
        </Button>
        {errorMessage}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant={isChosen ? "secondary" : "outline"}
          className="w-fit"
          aria-pressed={isChosen}
          onClick={() => setIsChosen((chosen) => !chosen)}
          disabled={isPending}
        >
          {isChosen ? "今日の候補にしました ✓" : "これにする"}
        </Button>
        {isChosen && (
          <Button
            type="button"
            size="sm"
            className="w-fit"
            onClick={handleWear}
            disabled={isPending}
          >
            {isPending ? "記録中..." : "今日着た"}
          </Button>
        )}
      </div>
      {errorMessage}
    </div>
  );
}
