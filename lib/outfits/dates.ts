// 日本時間（Asia/Tokyo, 常にUTC+9・サマータイムなし）の日付まわりの純粋な関数。
// 実行環境のタイムゾーンに左右されないよう、UTC の計算に +9時間を足して求める
// （lib/wear-logs.ts と同じ考え方。あちらは Supabase を読み込むので import しない）。

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** 日本時間の「今日」を YYYY-MM-DD で返す。now はテスト用に差し替えられる。 */
export function jstTodayIsoDate(now: Date = new Date()): string {
  return new Date(now.getTime() + JST_OFFSET_MS).toISOString().slice(0, 10);
}
