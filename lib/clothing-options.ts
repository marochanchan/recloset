export const CATEGORY_OPTIONS = [
  { value: "tops", label: "トップス" },
  { value: "bottoms", label: "ボトムス" },
  { value: "dress", label: "ワンピース" },
  { value: "outer", label: "アウター" },
  { value: "shoes", label: "シューズ" },
  { value: "bag", label: "バッグ" },
  { value: "other", label: "その他" },
] as const;

export const SEASON_OPTIONS = [
  { value: "spring", label: "春" },
  { value: "summer", label: "夏" },
  { value: "autumn", label: "秋" },
  { value: "winter", label: "冬" },
  { value: "all", label: "オールシーズン" },
] as const;

export const STATUS_OPTIONS = [
  { value: "closet", label: "クローゼット" },
  { value: "candidate", label: "手放し候補" },
  // 内部値はletting_goのまま（DBの既存値を変えない）。表示上は
  // 「フリマ等に実際に出品している」状態として扱う。
  // marketplace URLの有無とは連動しない（ユーザーが選んだ状態だけを表す）。
  { value: "letting_go", label: "出品中" },
  { value: "sold", label: "売却済み" },
] as const;

// ============================================================
// 種類（clothing_items.subcategory、migration 013）
// - 値は画像AIのスキーマ（lib/clothing-image-analysis.ts の Subcategory）と同じ
// - categories: その種類を選べるカテゴリー。シューズ・バッグ・その他には種類がない
// ============================================================
export const SUBCATEGORY_OPTIONS = [
  { value: "tshirt", label: "Tシャツ", categories: ["tops"] },
  { value: "shirt_blouse", label: "シャツ・ブラウス", categories: ["tops"] },
  { value: "knit", label: "ニット", categories: ["tops"] },
  { value: "cardigan", label: "カーディガン", categories: ["tops"] },
  { value: "vest", label: "ベスト", categories: ["tops"] },
  { value: "bustier", label: "ビスチェ", categories: ["tops"] },
  { value: "sweatshirt_hoodie", label: "スウェット・パーカー", categories: ["tops"] },
  { value: "jacket", label: "ジャケット", categories: ["outer"] },
  { value: "coat", label: "コート", categories: ["outer"] },
  { value: "pants", label: "パンツ", categories: ["bottoms"] },
  { value: "skirt", label: "スカート", categories: ["bottoms"] },
  { value: "shorts", label: "ショートパンツ", categories: ["bottoms"] },
  { value: "dress", label: "ワンピース", categories: ["dress"] },
  { value: "jumpsuit", label: "オールインワン", categories: ["dress"] },
  {
    value: "other",
    label: "その他",
    categories: ["tops", "bottoms", "dress", "outer"],
  },
] as const;

export type SubcategoryValue = (typeof SUBCATEGORY_OPTIONS)[number]["value"];

/** そのカテゴリーで選べる種類（種類のないカテゴリーは空配列） */
export function getSubcategoryOptions(category: string) {
  return SUBCATEGORY_OPTIONS.filter((option) =>
    (option.categories as readonly string[]).includes(category),
  );
}

/** 種類がカテゴリーに属しているか（値が不正・未設定ならfalse） */
export function isSubcategoryForCategory(
  category: string,
  subcategory: unknown,
): subcategory is SubcategoryValue {
  return getSubcategoryOptions(category).some(
    (option) => option.value === subcategory,
  );
}

export function getSubcategoryLabel(value: string): string {
  return (
    SUBCATEGORY_OPTIONS.find((option) => option.value === value)?.label ?? value
  );
}

// ============================================================
// メインカラー（clothing_items.main_color、migration 013）
// 値は画像AIのスキーマ（lib/clothing-image-analysis.ts の Color）と同じ
// ============================================================
export const COLOR_OPTIONS = [
  { value: "white", label: "白" },
  { value: "black", label: "黒" },
  { value: "gray", label: "グレー" },
  { value: "beige", label: "ベージュ" },
  { value: "brown", label: "ブラウン" },
  { value: "navy", label: "ネイビー" },
  { value: "blue", label: "ブルー" },
  { value: "green", label: "グリーン" },
  { value: "yellow", label: "イエロー" },
  { value: "orange", label: "オレンジ" },
  { value: "red", label: "レッド" },
  { value: "pink", label: "ピンク" },
  { value: "purple", label: "パープル" },
  { value: "multi", label: "マルチカラー" },
  { value: "other", label: "その他" },
] as const;

export type ColorValue = (typeof COLOR_OPTIONS)[number]["value"];

export function isColorValue(value: unknown): value is ColorValue {
  return COLOR_OPTIONS.some((option) => option.value === value);
}

export function getColorLabel(value: string): string {
  return COLOR_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

export function getCategoryLabel(value: string): string {
  return CATEGORY_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

export function getSeasonLabel(value: string): string {
  return SEASON_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

export function getStatusLabel(value: string): string {
  return STATUS_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

// ============================================================
// 季節（clothing_items.seasons: text[]、migration 012）
// - 春・夏・秋・冬の複数選択。空配列は未設定、4つすべてはオールシーズン
// - 並び順は常に 春→夏→秋→冬、重複なし（normalizeSeasonsで揃える）
// - 旧 season 列（単一値）は互換用。保存時に toLegacySeason で導いて書く
// ============================================================

export const SEASON_VALUES = ["spring", "summer", "autumn", "winter"] as const;

export type SeasonValue = (typeof SEASON_VALUES)[number];

export function isSeasonValue(value: unknown): value is SeasonValue {
  return (
    typeof value === "string" &&
    (SEASON_VALUES as readonly string[]).includes(value)
  );
}

/** 不正な値を除き、重複をなくして 春→夏→秋→冬 の順に並べる */
export function normalizeSeasons(
  values: readonly unknown[] | null | undefined,
): SeasonValue[] {
  const selected = new Set((values ?? []).filter(isSeasonValue));
  return SEASON_VALUES.filter((season) => selected.has(season));
}

export function isAllSeasons(seasons: readonly string[]): boolean {
  return normalizeSeasons(seasons).length === SEASON_VALUES.length;
}

/** 表示用ラベル。4つすべてなら「オールシーズン」、未設定ならnull */
export function formatSeasons(
  seasons: readonly string[] | null | undefined,
): string | null {
  const normalized = normalizeSeasons(seasons);
  if (normalized.length === 0) return null;
  if (normalized.length === SEASON_VALUES.length) return "オールシーズン";
  return normalized.map(getSeasonLabel).join("・");
}

/**
 * 旧 season 列（単一値）に書く値。4季節→'all'、1季節→その値、
 * それ以外（未設定・2〜3季節）→null。
 */
export function toLegacySeason(
  seasons: readonly string[],
): SeasonValue | "all" | null {
  const normalized = normalizeSeasons(seasons);
  if (normalized.length === SEASON_VALUES.length) return "all";
  if (normalized.length === 1) return normalized[0];
  return null;
}

/** 2つの季節の組み合わせが同じか（順序・重複を無視して比較する） */
export function isSameSeasons(
  a: readonly string[],
  b: readonly string[],
): boolean {
  const left = normalizeSeasons(a);
  const right = normalizeSeasons(b);
  return (
    left.length === right.length &&
    left.every((season, index) => season === right[index])
  );
}
