import {
  CLASSIFY_STATUSES,
  MAX_CLASSIFY_ITEMS,
  type ClassifyMode,
} from "@/lib/clothing-classify";
import {
  CATEGORY_OPTIONS,
  PHOTO_ONLY_CATEGORY,
  PHOTO_ONLY_TITLE,
  SUBCATEGORY_OPTIONS,
} from "@/lib/clothing-options";
import type { SupabaseClient } from "@supabase/supabase-js";

// 未分類の服の絞り込み（RLSにより本人の服だけが返る）。
// カテゴリ: 写真だけ登録したままで、分類した記録がない服（lib/clothing-classify.ts参照）
// シーズン: seasons が空配列の服
// クイック仕分けの画面とクローゼットの入口で同じ条件を使う
type Filter = [column: string, operator: string, value: string];

// 種類を選べるカテゴリ（SUBCATEGORY_OPTIONS から作る。tops・bottoms・dress・outer）
// 並びはカテゴリの表示順（CATEGORY_OPTIONS）
const SUBCATEGORY_CATEGORIES = CATEGORY_OPTIONS.map((c) => c.value).filter((value) =>
  SUBCATEGORY_OPTIONS.some((option) =>
    (option.categories as readonly string[]).includes(value),
  ),
);

// 種類 / カラー / ブランド: 値が null の服。
// タイトル: DBでは仮タイトルだけで絞る（カテゴリ未分類を外すのは selectClassifyItems で行う）
export const unclassifiedFilters = (mode: ClassifyMode): Filter[] => {
  switch (mode) {
    case "category":
      return [
        ["title", "eq", PHOTO_ONLY_TITLE],
        ["category", "eq", PHOTO_ONLY_CATEGORY],
        ["category_classified_at", "is", "null"],
      ];
    case "subcategory":
      return [
        ["subcategory", "is", "null"],
        ["category", "in", `(${SUBCATEGORY_CATEGORIES.join(",")})`],
      ];
    case "color":
      return [["main_color", "is", "null"]];
    case "season":
      return [["seasons", "eq", "{}"]];
    case "title":
      return [["title", "eq", PHOTO_ONLY_TITLE]];
    case "brand":
      return [["brand", "is", "null"]];
  }
};

/**
 * タイトルの件数用の条件（2つの数を足す。or を使わない）。
 * 仮タイトルで「カテゴリが other でない」か、「other だが分類した日時がある」服
 */
export const titleCountFilterSets = (): Filter[][] => [
  [
    ["title", "eq", PHOTO_ONLY_TITLE],
    ["category", "neq", PHOTO_ONLY_CATEGORY],
  ],
  [
    ["title", "eq", PHOTO_ONLY_TITLE],
    ["category", "eq", PHOTO_ONLY_CATEGORY],
    ["category_classified_at", "not.is", "null"],
  ],
];

/** 仕分け画面でDBから取る件数。タイトルは後で外れる服があるので多めに取る */
export const classifyFetchLimit = (mode: ClassifyMode): number =>
  mode === "title" ? 100 : MAX_CLASSIFY_ITEMS;

/** 未分類の服の数。取得に失敗したらnull */
export async function countUnclassified(
  supabase: SupabaseClient,
  mode: ClassifyMode,
): Promise<number | null> {
  const filterSets =
    mode === "title" ? titleCountFilterSets() : [unclassifiedFilters(mode)];
  let total = 0;
  for (const filters of filterSets) {
    let query = supabase
      .from("clothing_items")
      .select("*", { count: "exact", head: true })
      .in("status", [...CLASSIFY_STATUSES]);
    for (const [column, operator, value] of filters) {
      query = query.filter(column, operator, value);
    }
    const { count, error } = await query;
    if (error) {
      console.error("count unclassified items error:", error);
      return null;
    }
    total += count ?? 0;
  }
  return total;
}
