"use client";

import { cn } from "@/lib/utils";
import {
  claimWeeklyGoalCelebration,
  getBrowserStorage,
  WEEKLY_GOAL_CELEBRATION_MOTION_CLASS,
} from "@/lib/weekly-celebration";
import { Sparkles } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

// 週次目標を達成した週に一度だけ出す、小さなお祝い。
// 達成したかどうかはサーバーの実績（achieved）で決まり、ここでは
// 「このブラウザで今週すでに表示したか」だけを localStorage で管理する。
// お祝いは通常の見直しの言葉（children）と同じ位置に出し、表示中は置き換える
// （「今週の目標達成！…」と重ねて表示しない）。2回目以降・再読み込み時は children を表示する。
// サーバーでの描画と最初のクライアントの描画は常に children にそろえ
// （hydrationのずれを防ぐ）、お祝いに切り替えるかは描画後に決める
export function WeeklyGoalCelebration({
  achieved,
  weekStartDateKey,
  children,
}: {
  achieved: boolean | null;
  weekStartDateKey: string;
  /** お祝いを出さないときに表示する通常の言葉 */
  children: ReactNode;
}) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (
      claimWeeklyGoalCelebration({
        achieved,
        weekStartDateKey,
        storage: getBrowserStorage(),
      })
    ) {
      setVisible(true);
    }
  }, [achieved, weekStartDateKey]);

  if (!visible) return children;

  return (
    <p
      role="status"
      className={cn(
        "flex items-center gap-2 rounded-md bg-primary/10 px-3 py-2 text-sm font-medium",
        WEEKLY_GOAL_CELEBRATION_MOTION_CLASS,
      )}
    >
      <Sparkles className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
      今週の目標、達成しました！
    </p>
  );
}
