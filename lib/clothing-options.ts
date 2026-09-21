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

export function getCategoryLabel(value: string): string {
  return CATEGORY_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

export function getSeasonLabel(value: string): string {
  return SEASON_OPTIONS.find((option) => option.value === value)?.label ?? value;
}
