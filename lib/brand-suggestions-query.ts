import { buildBrandSuggestions } from "@/lib/brand-suggestions";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * 自分が登録した服のブランドから、入力欄の候補を作る（RLSにより本人の服だけが返る）。
 * 取得に失敗しても登録・編集は止めず、候補なしにする
 */
export async function fetchBrandSuggestions(supabase: SupabaseClient): Promise<string[]> {
  const { data, error } = await supabase
    .from("clothing_items")
    .select("brand")
    .not("brand", "is", null);
  if (error) {
    console.error("brand suggestions fetch error:", error);
    return [];
  }
  return buildBrandSuggestions(
    (data ?? []).map((row: { brand: string | null }) => row.brand),
  );
}
