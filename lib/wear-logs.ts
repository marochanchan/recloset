import { createClient } from "@/lib/supabase/server";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/**
 * 実行環境のローカルタイムゾーンに依存せず、UTCベースの計算だけで
 * 「今」が属する日本時間（Asia/Tokyo, 常にUTC+9・サマータイムなし）の
 * カレンダー日の開始・終了をUTC時刻として返す。
 */
export function getJstDayRangeUtc(referenceDate: Date = new Date()) {
  const jstShifted = new Date(referenceDate.getTime() + JST_OFFSET_MS);
  const startOfDayJstInUtc = new Date(
    Date.UTC(
      jstShifted.getUTCFullYear(),
      jstShifted.getUTCMonth(),
      jstShifted.getUTCDate(),
    ) - JST_OFFSET_MS,
  );
  const endOfDayJstInUtc = new Date(
    startOfDayJstInUtc.getTime() + 24 * 60 * 60 * 1000,
  );

  return { startUtc: startOfDayJstInUtc, endUtc: endOfDayJstInUtc };
}

/**
 * 指定した服について、日本時間の「今日」に該当するwear_logsが
 * 既に存在するかどうかを返す。
 */
export async function hasWornToday(
  supabase: SupabaseServerClient,
  clothingItemId: string,
): Promise<boolean> {
  const { startUtc, endUtc } = getJstDayRangeUtc();

  const { data, error } = await supabase
    .from("wear_logs")
    .select("id")
    .eq("clothing_item_id", clothingItemId)
    .gte("worn_at", startUtc.toISOString())
    .lt("worn_at", endUtc.toISOString())
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("hasWornToday error:", error);
    return false;
  }

  return Boolean(data);
}

const jstDateFormatter = new Intl.DateTimeFormat("ja-JP", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "long",
  day: "numeric",
});

/**
 * timestamptz（ISO文字列）を、実行環境のローカルタイムゾーンに依存せず
 * Asia/Tokyo基準の「YYYY年M月D日」形式に整形する。時刻は含めない。
 */
export function formatJstDate(isoString: string): string {
  return jstDateFormatter.format(new Date(isoString));
}
