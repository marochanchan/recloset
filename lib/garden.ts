// ============================================================
// Re:Garden（植物キャラクターの成長。純粋関数。DB・UI・AIに依存しない）
//
// - 成長ポイント: 日本時間の「1日 × 行動の種類」で1pt（1日最大5pt）。
//   集計はDBのRPC（get_closet_activity_kind_day_counts、migration 019）が
//   種類ごとの「行動した日数」として返し、ここではそれを合計する
// - 5種類（登録・着用・見直し・整理・循環）は同じ重み。手放しを特別扱いしない
// - ポイントは減らさない（行動しなかった日の減点・枯れる演出はない）。
//   取り消した見直し（revoked_at）はRPCの時点で数えない
// - 6段階。最後の段階（実）の後も累計ポイントは増え続ける
// 表示の文言は lib/garden-copy.ts、キャラクターの画像は lib/garden-characters.ts
// ============================================================

export const GARDEN_GROWTH_KINDS = [
  "register",
  "wear",
  "review",
  "organize",
  "circulate",
] as const;

export type GardenGrowthKind = (typeof GARDEN_GROWTH_KINDS)[number];

export const GARDEN_STAGES = [
  { key: "seed", minPoints: 0 },
  { key: "sprout", minPoints: 3 },
  { key: "young_leaf", minPoints: 10 },
  { key: "bud", minPoints: 25 },
  { key: "flower", minPoints: 50 },
  { key: "fruit", minPoints: 100 },
] as const;

export type GardenStage = (typeof GARDEN_STAGES)[number];
export type GardenStageKey = GardenStage["key"];

export function isGardenGrowthKind(value: unknown): value is GardenGrowthKind {
  return (GARDEN_GROWTH_KINDS as readonly unknown[]).includes(value);
}

/** 累計ポイントの段階（0〜5） */
export function getGardenStageIndex(totalPoints: number): number {
  let index = 0;
  GARDEN_STAGES.forEach((stage, i) => {
    if (totalPoints >= stage.minPoints) index = i;
  });
  return index;
}

/** RPC（get_closet_activity_kind_day_counts）の1行 */
export type GardenKindDayCountRow = { kind: unknown; day_count: unknown };

export type GardenGrowth = {
  totalPoints: number;
  /** 種類ごとのポイント（＝その種類の行動をした日数） */
  pointsByKind: Record<GardenGrowthKind, number>;
  stageIndex: number;
  stage: GardenStage;
  /** 次の段階。最後の段階ならnull */
  nextStage: GardenStage | null;
  /** 次の段階まであと何pt。最後の段階ならnull */
  pointsToNextStage: number | null;
  /** 今の段階から次の段階までの進み具合（0〜1）。最後の段階なら1 */
  progressToNextStage: number;
};

/**
 * RPCの結果から成長の状態を作る。
 * 知らない種類・不正な日数は数えない。同じ種類が重複していたら大きい方を使う（二重に数えない）
 */
export function buildGardenGrowth(rows: GardenKindDayCountRow[]): GardenGrowth {
  const pointsByKind = Object.fromEntries(
    GARDEN_GROWTH_KINDS.map((kind) => [kind, 0]),
  ) as Record<GardenGrowthKind, number>;

  for (const row of rows) {
    if (!isGardenGrowthKind(row.kind)) continue;
    const count = Number(row.day_count);
    if (!Number.isInteger(count) || count < 0) continue;
    pointsByKind[row.kind] = Math.max(pointsByKind[row.kind], count);
  }

  const totalPoints = GARDEN_GROWTH_KINDS.reduce(
    (sum, kind) => sum + pointsByKind[kind],
    0,
  );
  const stageIndex = getGardenStageIndex(totalPoints);
  const stage = GARDEN_STAGES[stageIndex];
  const nextStage = GARDEN_STAGES[stageIndex + 1] ?? null;

  return {
    totalPoints,
    pointsByKind,
    stageIndex,
    stage,
    nextStage,
    pointsToNextStage: nextStage ? nextStage.minPoints - totalPoints : null,
    progressToNextStage: nextStage
      ? (totalPoints - stage.minPoints) / (nextStage.minPoints - stage.minPoints)
      : 1,
  };
}

// ------------------------------------------------------------
// 成長のお祝い（段階が上がったときに一度だけ）
// ------------------------------------------------------------

const GARDEN_STAGE_STORAGE_KEY_PREFIX = "recloset:garden-seen-stage:";

/**
 * 前に見た段階を記録する localStorage のキー。ユーザーごとに分ける
 * （同じブラウザで別のアカウントに切り替えても、お祝いの判定が混ざらない）
 */
export function getGardenStageStorageKey(userId: string): string {
  return `${GARDEN_STAGE_STORAGE_KEY_PREFIX}${userId}`;
}

/** localStorage のうち使う部分だけ（テストで差し替えられるようにする） */
export type GardenStageStorage = Pick<Storage, "getItem" | "setItem">;

/**
 * 今回、成長のお祝いを表示するかを決め、見た段階を記録する（ユーザーごと）。
 * - ユーザーが分からないときは表示も記録もしない
 * - 初めて表示するとき（記録がない）: 記録だけして表示しない
 *   （既存データから育った状態で始まる人に「育った」と出さない）
 * - 前に見た段階より上がっていたら表示する
 * - 同じ・下がった（取り消しなど）ときは表示しない
 * - storage が使えない・読み書きに失敗した場合は表示しない
 */
export function claimGardenStageCelebration({
  userId,
  stageIndex,
  storage,
}: {
  userId: string | null;
  stageIndex: number;
  storage: GardenStageStorage | null;
}): boolean {
  if (!userId || !storage) return false;
  const key = getGardenStageStorageKey(userId);
  try {
    const stored = storage.getItem(key);
    const seen = stored === null ? null : Number(stored);
    storage.setItem(key, String(stageIndex));
    if (seen === null || !Number.isInteger(seen)) return false;
    return stageIndex > seen;
  } catch {
    return false;
  }
}
