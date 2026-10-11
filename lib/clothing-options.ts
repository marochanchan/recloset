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
