import { buildGardenGrowth, type GardenGrowth } from "@/lib/garden";
import type { SupabaseClient } from "@supabase/supabase-js";

// ============================================================
// Re:Garden のデータ取得（RPC get_closet_activity_kind_day_counts、migration 019）
// - RPCは本人の行動だけを、種類ごとの日数（最大5行）にまとめて返す。
//   行動履歴の全件は読まない
// - 例外は投げない。migration 019 が未適用などで失敗したら ok:false
// ============================================================

export type GardenResult = { ok: true; growth: GardenGrowth } | { ok: false };

export async function fetchGardenGrowth(
  supabase: SupabaseClient,
): Promise<GardenResult> {
  try {
    const { data, error } = await supabase.rpc("get_closet_activity_kind_day_counts");
    if (error || !Array.isArray(data)) {
      console.error("fetchGardenGrowth error:", error);
      return { ok: false };
    }
    return { ok: true, growth: buildGardenGrowth(data) };
  } catch (error) {
    console.error("fetchGardenGrowth exception:", error);
    return { ok: false };
  }
}
