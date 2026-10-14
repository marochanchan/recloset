"use client";

import {
  DEFAULT_GARDEN_CHARACTER,
  getGardenCharacterImageSrc,
} from "@/lib/garden-characters";
import { GARDEN_STAGES } from "@/lib/garden";
import { GARDEN_STAGE_LABELS } from "@/lib/garden-copy";
import Image from "next/image";
import { useState } from "react";

// Re:Garden のキャラクター。画像は lib/garden-characters.ts の規則で public/ に置く。
// 画像が未配置（hasImages: false）・読み込めないときは、仮の表示を出す
// （最終デザインと誤認されないよう、絵は描かずに段階名だけを示す）
const SIZE = 160;

export function GardenCharacter({ stageIndex }: { stageIndex: number }) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const stage = GARDEN_STAGES[stageIndex] ?? GARDEN_STAGES[0];
  const label = GARDEN_STAGE_LABELS[stage.key];
  const src = getGardenCharacterImageSrc(DEFAULT_GARDEN_CHARACTER, stageIndex);

  if (!src || failedSrc === src) {
    return (
      <div
        role="img"
        aria-label={`植物キャラクター（${label}）`}
        className="flex flex-col items-center justify-center gap-1 rounded-full border-2 border-dashed border-muted-foreground/30 bg-muted/40 text-muted-foreground"
        style={{ width: SIZE, height: SIZE }}
      >
        <span className="text-xs">
          {stageIndex + 1} / {GARDEN_STAGES.length}
        </span>
        <span className="text-lg font-semibold text-foreground">{label}</span>
        <span className="text-[10px]">イラスト準備中</span>
      </div>
    );
  }

  return (
    <Image
      key={src}
      src={src}
      alt={`植物キャラクター（${label}）`}
      width={SIZE}
      height={SIZE}
      priority={false}
      className="h-40 w-40 object-contain"
      onError={() => setFailedSrc(src)}
    />
  );
}
