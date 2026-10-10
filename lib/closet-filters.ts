import { CATEGORY_OPTIONS, SEASON_OPTIONS } from "@/lib/clothing-options";

// ============================================================
// クローゼット一覧（/protected/items）の絞り込み
// （URLの ?category= / ?season= / ?favorite=1 / ?status=candidate）
//
// - 値はclothing-options.tsの定義（DBに保存する値）と完全一致のものだけ受け付け、
//   不正値・未指定は「すべて」（null）として扱う。
// - favorite / status は Todayのクローゼットサマリー（お気に入り・手放し候補）
//   から同じ条件の一覧を開くためのもの。statusは手放し候補だけを受け付ける。
// - seasonは選んだ値と完全一致で絞り込む（天気提案と違い、"all"を含める
//   といった拡張はしない）。
// ============================================================

export const CLOSET_FILTER_PATH = "/protected/items";

type CategoryValue = (typeof CATEGORY_OPTIONS)[number]["value"];
type SeasonValue = (typeof SEASON_OPTIONS)[number]["value"];

const STATUS_FILTER_OPTIONS = [{ value: "candidate" }] as const;
type StatusFilterValue = (typeof STATUS_FILTER_OPTIONS)[number]["value"];

const FILTER_PARAM_KEYS = ["category", "season", "favorite", "status"];

export type ClosetFilters = {
  category: CategoryValue | null;
  season: SeasonValue | null;
  /** trueのときお気に入りだけ（?favorite=1） */
  favorite: boolean;
  status: StatusFilterValue | null;
};

export type RawSearchParams = Record<string, string | string[] | undefined>;

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function pickValid<T extends string>(
  options: readonly { value: T }[],
  value: string | undefined,
): T | null {
  return options.find((option) => option.value === value)?.value ?? null;
}

export function parseClosetFilters(
  searchParams: RawSearchParams,
): ClosetFilters {
  return {
    category: pickValid(CATEGORY_OPTIONS, firstValue(searchParams.category)),
    season: pickValid(SEASON_OPTIONS, firstValue(searchParams.season)),
    favorite: firstValue(searchParams.favorite) === "1",
    status: pickValid(STATUS_FILTER_OPTIONS, firstValue(searchParams.status)),
  };
}

export function hasActiveClosetFilters(filters: ClosetFilters): boolean {
  return (
    filters.category !== null ||
    filters.season !== null ||
    filters.favorite ||
    filters.status !== null
  );
}

/**
 * 絞り込みを1つ変更したときのURLを返す。
 * もう一方の絞り込みと、無関係なquery paramはそのまま残す。
 * 「すべて」（null）を選んだ場合はそのparamだけ削除する。
 * 現在の絞り込みが不正値だった場合は、URLからも取り除く。
 */
export function buildClosetFilterHref(
  searchParams: RawSearchParams,
  current: ClosetFilters,
  change: Partial<ClosetFilters>,
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (FILTER_PARAM_KEYS.includes(key) || value === undefined) {
      continue;
    }
    for (const v of Array.isArray(value) ? value : [value]) {
      params.append(key, v);
    }
  }

  const next = { ...current, ...change };
  if (next.category) params.set("category", next.category);
  if (next.season) params.set("season", next.season);
  if (next.favorite) params.set("favorite", "1");
  if (next.status) params.set("status", next.status);

  const query = params.toString();
  return query ? `${CLOSET_FILTER_PATH}?${query}` : CLOSET_FILTER_PATH;
}
