import { cacheLife } from "next/cache";

// ============================================================
// 今日の天気（Open-Meteo Forecast API・横浜固定）
//
// - 卒制の非商用プロトタイプとしてOpen-MeteoのFree APIを使う
//   （APIキー不要・利用上限あり・CC BY 4.0のため出典リンクの表示が必須）。
//   将来商用化する場合は契約・利用条件を見直すこと。
// - 地域は横浜固定。ユーザーの位置情報は取得しない。
// - サーバー側でのみ取得し、外部へ送るのは固定の座標だけ。
// - レスポンスは外部入力として検証し、不正な値は使わない。
// ============================================================

/** 天気を取得する地域（卒制版は横浜固定。座標はここだけで管理する） */
export const WEATHER_LOCATION = {
  name: "横浜",
  latitude: 35.4437,
  longitude: 139.638,
} as const;

export const OPEN_METEO_ATTRIBUTION_URL = "https://open-meteo.com/";
export const OPEN_METEO_LICENSE_URL =
  "https://creativecommons.org/licenses/by/4.0/";

const FORECAST_ENDPOINT = "https://api.open-meteo.com/v1/forecast";
const FETCH_TIMEOUT_MS = 3000;

export type DailyWeather = {
  /** 予報対象日（Asia/Tokyo, YYYY-MM-DD） */
  date: string;
  maxTemp: number;
  minTemp: number;
  /** 降水確率の最大値（%）。取得できない場合はnull */
  precipitationProbability: number | null;
  /** WMO weather code。表示名に変換できない値はnull */
  weatherCode: number | null;
};

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** 日本時間の今日の日付（YYYY-MM-DD） */
export function getJstDateKey(referenceDate: Date = new Date()): string {
  return new Date(referenceDate.getTime() + JST_OFFSET_MS)
    .toISOString()
    .slice(0, 10);
}

// WMO weather code → 表示名（Open-Meteo公式ドキュメントのコード表に対応）
const WEATHER_CODE_LABELS: Record<number, string> = {
  0: "晴れ",
  1: "晴れ",
  2: "晴れ時々くもり",
  3: "くもり",
  45: "霧",
  48: "霧",
  51: "霧雨",
  53: "霧雨",
  55: "霧雨",
  56: "霧雨",
  57: "霧雨",
  61: "雨",
  63: "雨",
  65: "強い雨",
  66: "雨",
  67: "強い雨",
  71: "雪",
  73: "雪",
  75: "強い雪",
  77: "雪",
  80: "にわか雨",
  81: "にわか雨",
  82: "強いにわか雨",
  85: "にわか雪",
  86: "にわか雪",
  95: "雷雨",
  96: "雷雨",
  99: "雷雨",
};

export function getWeatherLabel(code: number | null): string | null {
  return code === null ? null : (WEATHER_CODE_LABELS[code] ?? null);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function firstNumber(value: unknown): number | null {
  if (!Array.isArray(value)) return null;
  const first: unknown = value[0];
  return typeof first === "number" && Number.isFinite(first) ? first : null;
}

const isPlausibleTemp = (value: number) => value >= -50 && value <= 60;

/**
 * Open-Meteoのレスポンス（外部入力）を検証して今日の天気に変換する。
 * 気温が欠けている・範囲外などで信頼できない場合はnull。
 * 降水確率・天気コードは任意項目として、不正ならnullにする。
 */
export function parseDailyWeather(json: unknown): DailyWeather | null {
  if (!isRecord(json) || !isRecord(json.daily)) return null;
  const daily = json.daily;

  const date = Array.isArray(daily.time) ? daily.time[0] : undefined;
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return null;
  }

  const maxTemp = firstNumber(daily.temperature_2m_max);
  const minTemp = firstNumber(daily.temperature_2m_min);
  if (
    maxTemp === null ||
    minTemp === null ||
    !isPlausibleTemp(maxTemp) ||
    !isPlausibleTemp(minTemp) ||
    minTemp > maxTemp
  ) {
    return null;
  }

  const precipitation = firstNumber(daily.precipitation_probability_max);
  const code = firstNumber(daily.weather_code);

  return {
    date,
    maxTemp,
    minTemp,
    precipitationProbability:
      precipitation !== null && precipitation >= 0 && precipitation <= 100
        ? Math.round(precipitation)
        : null,
    weatherCode:
      code !== null && Number.isInteger(code) && code in WEATHER_CODE_LABELS
        ? code
        : null,
  };
}

/**
 * Open-Meteoから指定日（JST）の横浜の天気を取得する。30分キャッシュ。
 * dateKeyを引数（キャッシュキー）にして、日付が変わったら前日の値を使わない。
 * 失敗時は値を返さずthrowする（失敗結果をキャッシュの値にしないため）。
 */
async function fetchDailyWeather(dateKey: string): Promise<DailyWeather> {
  "use cache";
  cacheLife({ revalidate: 1800, expire: 7200 });

  const params = new URLSearchParams({
    latitude: String(WEATHER_LOCATION.latitude),
    longitude: String(WEATHER_LOCATION.longitude),
    daily:
      "temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code",
    timezone: "Asia/Tokyo",
    forecast_days: "1",
  });

  const response = await fetch(`${FORECAST_ENDPOINT}?${params}`, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`Open-Meteo responded with ${response.status}`);
  }

  const weather = parseDailyWeather(await response.json());
  if (!weather || weather.date !== dateKey) {
    throw new Error("Open-Meteo response was invalid");
  }
  return weather;
}

/**
 * 今日の横浜の天気。取得・検証に失敗した場合はnull
 * （呼び出し側は月ベースの季節にフォールバックし、ページ全体はエラーにしない）。
 */
export async function getTodayWeather(): Promise<DailyWeather | null> {
  try {
    return await fetchDailyWeather(getJstDateKey());
  } catch (error) {
    console.error("getTodayWeather failed:", error);
    return null;
  }
}
