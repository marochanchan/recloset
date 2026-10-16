"use client";

import { updateWeeklyReviewGoal } from "@/app/(main)/protected/settings/actions";
import { Button } from "@/components/ui/button";
import {
  toWeeklyReviewGoalValue,
  type WeeklyReviewGoal,
  type WeeklyReviewGoalValue,
} from "@/lib/habit-progress";
import {
  formatWeeklyReviewGoal,
  WEEKLY_REVIEW_GOAL_CHOICES,
} from "@/lib/habit-progress-copy";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { useState, useTransition } from "react";

type WeeklyReviewGoalFormProps = {
  /** 保存済みの目標（未保存なら3着）。読み込めなかった場合は undefined */
  initialGoal: WeeklyReviewGoal | undefined;
};

export function WeeklyReviewGoalForm({ initialGoal }: WeeklyReviewGoalFormProps) {
  const initialValue =
    initialGoal === undefined ? null : toWeeklyReviewGoalValue(initialGoal);
  // 選択中の値（保存に失敗しても戻さない）と、保存済みの値
  const [selected, setSelected] = useState<WeeklyReviewGoalValue | null>(initialValue);
  const [savedValue, setSavedValue] = useState<WeeklyReviewGoalValue | null>(initialValue);
  const [savedGoal, setSavedGoal] = useState<WeeklyReviewGoal | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const isUnchanged = selected !== null && selected === savedValue;

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (isPending || selected === null) return;
    setError(null);
    setSavedGoal(undefined);

    const value = selected;
    startTransition(async () => {
      try {
        const result = await updateWeeklyReviewGoal(value);
        if (result.error !== null) {
          setError(result.error);
          return;
        }
        setSavedValue(toWeeklyReviewGoalValue(result.goal));
        setSavedGoal(result.goal);
      } catch {
        // 通信エラーなど。選択内容はそのまま残し、再試行できるようにする
        setError("目標の保存に失敗しました。時間をおいてもう一度お試しください");
      }
    });
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <fieldset className="flex flex-col gap-2" disabled={isPending}>
        <legend className="sr-only">週次の見直し目標</legend>
        {WEEKLY_REVIEW_GOAL_CHOICES.map((choice) => {
          const id = `weekly-review-goal-${choice.value}`;
          const checked = selected === choice.value;
          return (
            <label
              key={choice.value}
              htmlFor={id}
              className={cn(
                "flex min-h-12 cursor-pointer items-center gap-3 rounded-md border px-3 py-2 transition-colors",
                checked ? "border-primary bg-primary/5" : "hover:bg-accent",
                isPending && "cursor-not-allowed opacity-70",
              )}
            >
              <input
                id={id}
                type="radio"
                name="weekly-review-goal"
                value={choice.value}
                checked={checked}
                onChange={() => {
                  setSelected(choice.value);
                  setSavedGoal(undefined);
                }}
                className="h-4 w-4 shrink-0 accent-primary"
              />
              <span className="flex flex-1 flex-wrap items-baseline gap-x-2">
                <span className="text-sm font-medium">{choice.label}</span>
                <span className="text-xs text-muted-foreground">
                  {choice.description}
                </span>
              </span>
              {savedValue === choice.value && (
                <span className="shrink-0 text-xs text-muted-foreground">現在の目標</span>
              )}
            </label>
          );
        })}
      </fieldset>
      <Button type="submit" disabled={isPending || selected === null || isUnchanged}>
        {isPending ? "保存中..." : "保存する"}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {savedGoal !== undefined && (
        <div role="status" className="flex flex-col gap-1">
          <p className="text-sm">
            週次の目標を「{formatWeeklyReviewGoal(savedGoal)}」に保存しました。
          </p>
          <Link href="/today" className="w-fit text-sm underline underline-offset-4">
            Todayで今週の進捗を見る
          </Link>
        </div>
      )}
    </form>
  );
}
