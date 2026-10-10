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
