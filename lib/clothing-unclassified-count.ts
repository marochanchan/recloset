import {
  CLASSIFY_STATUSES,
  type ClassifyMode,
} from "@/lib/clothing-classify";
import { PHOTO_ONLY_CATEGORY, PHOTO_ONLY_TITLE } from "@/lib/clothing-options";
import type { SupabaseClient } from "@supabase/supabase-js";

// 未分類の服の絞り込み（RLSにより本人の服だけが返る）。
// カテゴリ: 写真だけ登録したままで、分類した記録がない服（lib/clothing-classify.ts参照）
// シーズン: seasons が空配列の服
// クイック仕分けの画面とクローゼットの入口で同じ条件を使う
export const unclassifiedFilters = (
  mode: ClassifyMode,
): [column: string, operator: string, value: string][] =>
  mode === "category"
    ? [
        ["title", "eq", PHOTO_ONLY_TITLE],
        ["category", "eq", PHOTO_ONLY_CATEGORY],
        ["category_classified_at", "is", "null"],
      ]
    : [["seasons", "eq", "{}"]];

/** 未分類の服の数。取得に失敗したらnull */
export async function countUnclassified(
  supabase: SupabaseClient,
  mode: ClassifyMode,
): Promise<number | null> {
  let query = supabase
    .from("clothing_items")
    .select("*", { count: "exact", head: true })
    .in("status", [...CLASSIFY_STATUSES]);
  for (const [column, operator, value] of unclassifiedFilters(mode)) {
    query = query.filter(column, operator, value);
  }
  const { count, error } = await query;
  if (error) {
    console.error("count unclassified items error:", error);
    return null;
  }
  return count ?? 0;
}
