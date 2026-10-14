"use client";

import { RE_QUEST_CELEBRATION_MESSAGE } from "@/lib/re-quest-copy";
import { claimReQuestCelebration } from "@/lib/re-quest";
import { cn } from "@/lib/utils";
import {
  getBrowserStorage,
  WEEKLY_GOAL_CELEBRATION_MOTION_CLASS,
} from "@/lib/weekly-celebration";
import { Sparkles } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

// 今日のクエストを達成した日に一度だけ出す、小さなお祝い（WeeklyGoalCelebrationと同じ作り）。
// 達成したかどうかはサーバーの実績で決まり、ここでは「このブラウザで今日すでに
// 表示したか」だけを localStorage で管理する。サーバーでの描画と最初のクライアントの
// 描画は children にそろえ（hydrationのずれを防ぐ）、お祝いに切り替えるかは描画後に決める
export function ReQuestCelebration({
  achievedToday,
  todayDateKey,
  children,
}: {
  achievedToday: boolean;
  todayDateKey: string;
  /** お祝いを出さないときに表示する通常の言葉 */
  children: ReactNode;
}) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (
      claimReQuestCelebration({
        achievedToday,
        todayDateKey,
        storage: getBrowserStorage(),
      })
    ) {
      setVisible(true);
    }
  }, [achievedToday, todayDateKey]);

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
      {RE_QUEST_CELEBRATION_MESSAGE}
    </p>
  );
}
