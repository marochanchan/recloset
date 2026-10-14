import { GARDEN_STAGES, type GardenStageKey } from "@/lib/garden";

// ============================================================
// Re:Garden のキャラクター画像（6段階）
//
// 画像の置き場所と名前（public/ 以下。差し替えはファイルを置き換えるだけ）:
//   public/garden/characters/<キャラクターID>/stage-<段階番号>-<段階キー>.webp
//   例: public/garden/characters/default/stage-0-seed.webp
//       stage-1-sprout / stage-2-young_leaf / stage-3-bud / stage-4-flower / stage-5-fruit
// 推奨: 1024×1024px の正方形、背景透過の WebP（1枚150KB程度まで）。
//   6枚とも同じキャンバス・同じ足元の位置・同じ余白（上下左右10%程度）にそろえる
//   （段階が変わっても位置がずれないように）。表示は最大192px程度
//
// 6枚を配置したら、そのキャラクターの hasImages を true にする。
// false の間、または画像を読み込めなかったときは、仮の表示（プレースホルダー）を出す。
// 画像のパスは文字列なので、未配置でもビルドは失敗しない
// ============================================================

export type GardenCharacter = {
  id: string;
  /** 6段階の画像を public/garden/characters/<id>/ に配置済みか */
  hasImages: boolean;
};

export const DEFAULT_GARDEN_CHARACTER: GardenCharacter = {
  id: "default",
  // 6段階の画像を public/garden/characters/default/ に配置済み
  hasImages: true,
};

/** 規則どおりの画像のパス（配置済みかどうかは見ない） */
export function getGardenCharacterImagePath(
  characterId: string,
  stageIndex: number,
  stageKey: GardenStageKey,
): string {
  return `/garden/characters/${characterId}/stage-${stageIndex}-${stageKey}.webp`;
}

/** 表示する画像のパス。画像が未配置ならnull（プレースホルダーを出す） */
export function getGardenCharacterImageSrc(
  character: GardenCharacter,
  stageIndex: number,
): string | null {
  const stage = GARDEN_STAGES[stageIndex];
  if (!character.hasImages || !stage) return null;
  return getGardenCharacterImagePath(character.id, stageIndex, stage.key);
}
