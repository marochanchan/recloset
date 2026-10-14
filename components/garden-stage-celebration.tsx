"use client";

import { claimGardenStageCelebration, type GardenStageKey } from "@/lib/garden";
import { getGardenCelebrationMessage } from "@/lib/garden-copy";
import { cn } from "@/lib/utils";
import {
  getBrowserStorage,
  WEEKLY_GOAL_CELEBRATION_MOTION_CLASS,
} from "@/lib/weekly-celebration";
import { Sparkles } from "lucide-react";
import { useEffect, useState } from "react";

// 植物の段階が上がったときに一度だけ出す、小さなお祝い（ReQuestCelebrationと同じ作り）。
// 段階はサーバーの実績で決まり、ここでは「このブラウザで前に見た段階」だけを
// localStorage でユーザーごとに管理する。サーバーでの描画と最初のクライアントの描画では何も出さず
// （hydrationのずれを防ぐ）、表示するかは描画後に決める
export function GardenStageCelebration({
  userId,
  stageIndex,
  stageKey,
}: {
  /** ログイン中のユーザーID（お祝いの記録をユーザーごとに分ける） */
  userId: string | null;
  stageIndex: number;
  stageKey: GardenStageKey;
}) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (
      claimGardenStageCelebration({ userId, stageIndex, storage: getBrowserStorage() })
    ) {
      setVisible(true);
    }
  }, [userId, stageIndex]);

  if (!visible) return null;

  return (
    <p
      role="status"
      className={cn(
        "flex items-center gap-2 rounded-md bg-primary/10 px-3 py-2 text-sm font-medium",
        WEEKLY_GOAL_CELEBRATION_MOTION_CLASS,
      )}
    >
      <Sparkles className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
      {getGardenCelebrationMessage(stageKey)}
    </p>
  );
}
