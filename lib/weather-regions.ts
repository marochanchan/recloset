// ============================================================
// 天気の地域（47都道府県）と、地域設定のCookie
//
// - 代表地点は各都道府県庁舎。座標は国土地理院の住所検索
//   （msearch.gsi.go.jp/address-search、「〇〇庁舎」の地点）で確認した値を
//   小数4桁（約10m）に丸めたもの。
// - 現在地から設定するときも、正確な緯度・経度はブラウザの中だけで使い、
//   一番近い代表地点の地域キーだけをCookieに保存する（座標は保存・送信しない）。
// - Cookieの値は外部入力。サーバーでは必ず getWeatherRegion() で一覧と照合する。
// - サーバー・クライアントの両方から使うため、Node専用のAPIは使わない。
// ============================================================

export type WeatherRegion = {
  key: string;
  /** 表示名（「東京都」「神奈川県」など） */
  name: string;
  latitude: number;
  longitude: number;
};

export const WEATHER_REGIONS: readonly WeatherRegion[] = [
  { key: "hokkaido", name: "北海道", latitude: 43.0643, longitude: 141.3469 },
  { key: "aomori", name: "青森県", latitude: 40.8246, longitude: 140.7405 },
  { key: "iwate", name: "岩手県", latitude: 39.7035, longitude: 141.1527 },
  { key: "miyagi", name: "宮城県", latitude: 38.2686, longitude: 140.8721 },
  { key: "akita", name: "秋田県", latitude: 39.7186, longitude: 140.1024 },
  { key: "yamagata", name: "山形県", latitude: 38.2404, longitude: 140.3637 },
  { key: "fukushima", name: "福島県", latitude: 37.7500, longitude: 140.4678 },
  { key: "ibaraki", name: "茨城県", latitude: 36.3417, longitude: 140.4468 },
  { key: "tochigi", name: "栃木県", latitude: 36.5659, longitude: 139.8836 },
  { key: "gunma", name: "群馬県", latitude: 36.3907, longitude: 139.0605 },
  { key: "saitama", name: "埼玉県", latitude: 35.8570, longitude: 139.6490 },
  { key: "chiba", name: "千葉県", latitude: 35.6046, longitude: 140.1232 },
  { key: "tokyo", name: "東京都", latitude: 35.6895, longitude: 139.6917 },
  { key: "kanagawa", name: "神奈川県", latitude: 35.4477, longitude: 139.6425 },
  { key: "niigata", name: "新潟県", latitude: 37.9025, longitude: 139.0232 },
  { key: "toyama", name: "富山県", latitude: 36.6953, longitude: 137.2113 },
  { key: "ishikawa", name: "石川県", latitude: 36.5946, longitude: 136.6257 },
  { key: "fukui", name: "福井県", latitude: 36.0652, longitude: 136.2217 },
  { key: "yamanashi", name: "山梨県", latitude: 35.6641, longitude: 138.5685 },
  { key: "nagano", name: "長野県", latitude: 36.6513, longitude: 138.1809 },
  { key: "gifu", name: "岐阜県", latitude: 35.3912, longitude: 136.7237 },
  { key: "shizuoka", name: "静岡県", latitude: 34.9769, longitude: 138.3831 },
  { key: "aichi", name: "愛知県", latitude: 35.1802, longitude: 136.9066 },
  { key: "mie", name: "三重県", latitude: 34.7303, longitude: 136.5086 },
  { key: "shiga", name: "滋賀県", latitude: 35.0045, longitude: 135.8686 },
  { key: "kyoto", name: "京都府", latitude: 35.0212, longitude: 135.7556 },
  { key: "osaka", name: "大阪府", latitude: 34.6863, longitude: 135.5200 },
  { key: "hyogo", name: "兵庫県", latitude: 34.6913, longitude: 135.1831 },
  { key: "nara", name: "奈良県", latitude: 34.6853, longitude: 135.8329 },
  { key: "wakayama", name: "和歌山県", latitude: 34.2261, longitude: 135.1675 },
  { key: "tottori", name: "鳥取県", latitude: 35.5034, longitude: 134.2383 },
  { key: "shimane", name: "島根県", latitude: 35.4723, longitude: 133.0505 },
  { key: "okayama", name: "岡山県", latitude: 34.6617, longitude: 133.9350 },
  { key: "hiroshima", name: "広島県", latitude: 34.3966, longitude: 132.4596 },
  { key: "yamaguchi", name: "山口県", latitude: 34.1860, longitude: 131.4707 },
  { key: "tokushima", name: "徳島県", latitude: 34.0658, longitude: 134.5593 },
  { key: "kagawa", name: "香川県", latitude: 34.3401, longitude: 134.0433 },
  { key: "ehime", name: "愛媛県", latitude: 33.8416, longitude: 132.7657 },
  { key: "kochi", name: "高知県", latitude: 33.5597, longitude: 133.5311 },
  { key: "fukuoka", name: "福岡県", latitude: 33.6064, longitude: 130.4180 },
  { key: "saga", name: "佐賀県", latitude: 33.2494, longitude: 130.2988 },
  { key: "nagasaki", name: "長崎県", latitude: 32.7500, longitude: 129.8673 },
  { key: "kumamoto", name: "熊本県", latitude: 32.7898, longitude: 130.7416 },
  { key: "oita", name: "大分県", latitude: 33.2381, longitude: 131.6126 },
  { key: "miyazaki", name: "宮崎県", latitude: 31.9110, longitude: 131.4239 },
  { key: "kagoshima", name: "鹿児島県", latitude: 31.5602, longitude: 130.5580 },
  { key: "okinawa", name: "沖縄県", latitude: 26.2124, longitude: 127.6809 },
];

export const WEATHER_REGION_COOKIE = "recloset_weather_region";

/** Cookieの有効期限（1年） */
export const WEATHER_REGION_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** 地域キーを検証して地域を返す。未設定・一覧にない値はnull（未設定として扱う） */
export function getWeatherRegion(
  key: string | null | undefined,
): WeatherRegion | null {
  if (!key) return null;
  return WEATHER_REGIONS.find((region) => region.key === key) ?? null;
}

// 一番近い代表地点がこれより遠い場合は、日本国内の現在地と判断しない
// （離島の一部は手動で選んでもらう）
const MAX_NEAREST_DISTANCE_KM = 600;

const EARTH_RADIUS_KM = 6371;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** 2地点間の距離（km、球面上の大円距離） */
export function getDistanceKm(
  from: { latitude: number; longitude: number },
  to: { latitude: number; longitude: number },
): number {
  const dLat = toRadians(to.latitude - from.latitude);
  const dLon = toRadians(to.longitude - from.longitude);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(from.latitude)) *
      Math.cos(toRadians(to.latitude)) *
      Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * 現在地に一番近い代表地点の地域。日本国内と判断できない（遠すぎる・値が不正）場合はnull。
 * 県境の近くでは、隣の都道府県が選ばれることがある（画面で変更できる）。
 */
export function findNearestWeatherRegion(position: {
  latitude: number;
  longitude: number;
}): WeatherRegion | null {
  if (
    !Number.isFinite(position.latitude) ||
    !Number.isFinite(position.longitude)
  ) {
    return null;
  }
  let nearest: WeatherRegion | null = null;
  let nearestDistance = Infinity;
  for (const region of WEATHER_REGIONS) {
    const distance = getDistanceKm(position, region);
    if (distance < nearestDistance) {
      nearest = region;
      nearestDistance = distance;
    }
  }
  return nearestDistance <= MAX_NEAREST_DISTANCE_KM ? nearest : null;
}
