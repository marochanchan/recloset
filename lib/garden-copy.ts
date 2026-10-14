import type {
  GardenGrowth,
  GardenGrowthKind,
  GardenStageKey,
} from "@/lib/garden";

// ============================================================
// Re:Garden の表示文言（成長の計算は lib/garden.ts）
// - どの行動も同じように肯定する。手放した数を成果として強調しない
// - 行動しなかった日・減ることを示す言葉は使わない
// ============================================================

export const GARDEN_CARD_TITLE = "Re:Garden";

export const GARDEN_LEAD = "行動した日ごとに、種類ごとに1ptずつ育ちます。";

export const GARDEN_LOAD_ERROR_MESSAGE = "庭のようすを読み込めませんでした";

export const GARDEN_STAGE_LABELS: Record<GardenStageKey, string> = {
  seed: "種",
  sprout: "芽",
  young_leaf: "若葉",
  bud: "つぼみ",
  flower: "花",
  fruit: "実",
};

export const GARDEN_KIND_LABELS: Record<GardenGrowthKind, string> = {
  register: "登録",
  wear: "着用",
  review: "見直し",
  organize: "整理",
  circulate: "循環",
};

/** 次の段階までの言葉（最後の段階の後も、育ち続けることを伝える） */
export function getGardenNextStageMessage(growth: GardenGrowth): string {
  if (!growth.nextStage || growth.pointsToNextStage === null) {
    return "実りました。これからも行動するたびに、ポイントが積み重なっていきます。";
  }
  return `あと${growth.pointsToNextStage}ptで「${GARDEN_STAGE_LABELS[growth.nextStage.key]}」に育ちます`;
}

export function getGardenCelebrationMessage(stageKey: GardenStageKey): string {
  return `「${GARDEN_STAGE_LABELS[stageKey]}」に育ちました！`;
}
