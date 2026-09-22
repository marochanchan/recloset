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

/**
 * 2つの時刻について、Asia/Tokyo基準の「暦日」が何日離れているかを返す。
 * 経過時間（24時間単位）ではなく、日本時間のカレンダー日の差で計算する。
 * getJstDayRangeUtc() が返すJST真夜中のUTC時刻同士の差は常に24時間の
 * 整数倍になるため、そのまま日数に変換できる。
 */
export function getJstCalendarDaysDiff(from: Date, to: Date): number {
  const fromStartUtc = getJstDayRangeUtc(from).startUtc.getTime();
  const toStartUtc = getJstDayRangeUtc(to).startUtc.getTime();
  return Math.round((toStartUtc - fromStartUtc) / (24 * 60 * 60 * 1000));
}

/**
 * last_worn_at（timestamptzのISO文字列、未着用ならnull）から、
 * Asia/Tokyo基準で「何日着ていないか」を返す。
 * 未着用（null）の場合はnullを返す。将来のAI診断・フィルター
 * （例:「90日以上着ていない服」）から再利用できるよう、
 * 表示用の文言とは分離した数値のみの関数にしている。
 */
export function getDaysSinceLastWorn(
  lastWornAt: string | null,
  referenceDate: Date = new Date(),
): number | null {
  if (!lastWornAt) return null;
  return getJstCalendarDaysDiff(new Date(lastWornAt), referenceDate);
}

/**
 * last_worn_at から、一覧カードなどにそのまま表示できる着用状況の
 * 短い文言を返す（例:「今日着ました」「3日着ていません」「着用記録なし」）。
 */
export function getWearRecencyLabel(
  lastWornAt: string | null,
  referenceDate: Date = new Date(),
): string {
  const daysSince = getDaysSinceLastWorn(lastWornAt, referenceDate);
  if (daysSince === null) return "着用記録なし";
  if (daysSince <= 0) return "今日着ました";
  return `${daysSince}日着ていません`;
}
