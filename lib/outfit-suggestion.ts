import { getSeasonLabel } from "@/lib/clothing-options";

// ============================================================
// 今日のコーデ候補（完全ルールベース・純粋関数）
//
// 天気（今日の最高/最低気温）と、自分の服のseason・status・着用履歴から、
// トップス（またはワンピース）・ボトムス・必要な日だけアウターを1着ずつ選ぶ。
// 色や形の相性を判断するものではなく、「今日着る服をクローゼットから
// 再発見する候補」として、選んだ理由を実データから説明できる形で返す。
// ============================================================

type Season = "spring" | "summer" | "autumn" | "winter";

export type OutfitSlot = "main" | "bottoms" | "outer";

export type OutfitItemInput = {
  id: string;
  title: string;
  brand: string | null;
  category: string;
  season: string | null;
  status: string;
  favorite: boolean;
  /** 最後の着用からの日数（JST。0=今日、1=昨日）。記録なしはnull */
  daysSinceLastWorn: number | null;
  imagePath: string | null;
};

export type OutfitPick = {
  slot: OutfitSlot;
  item: OutfitItemInput;
  /** 提案理由（最大2つ） */
  reasons: string[];
  /** 今日すでに着用記録がある服（提案ではなく「今日着た服」として表示） */
  wornToday: boolean;
};

export type OutfitSuggestion = {
  /** weather: 今日の気温から判定 / month: 天気が取れず月ベースの季節で判定 */
  basis: "weather" | "month";
  needsOuter: boolean;
  picks: OutfitPick[];
};

type OutfitWeatherInput = { maxTemp: number; minTemp: number };

const ELIGIBLE_STATUSES = ["closet", "candidate"];
const MAIN_CATEGORIES = ["tops", "dress"];
const MAX_REASONS = 2;

/**
 * 今日の最高気温に合うseason。seasonは1着につき1つしか登録できないため、
 * 春と秋は近いグループとして扱い、境界の気温帯では隣の季節も含める。
 * "all"（オールシーズン）は常に対象（ここでは返さず別扱い）。
 */
export function getSuitableSeasonsForTemp(maxTemp: number): Season[] {
  if (maxTemp >= 25) return ["summer"];
  if (maxTemp >= 18) return ["spring", "autumn", "summer"];
  if (maxTemp >= 10) return ["spring", "autumn", "winter"];
  return ["winter", "autumn"];
}

/** 天気が取れない場合の、月ベースの季節に合うseason */
export function getSuitableSeasonsForMonth(currentSeason: Season): Season[] {
  if (currentSeason === "summer") return ["summer"];
  if (currentSeason === "winter") return ["winter"];
  return ["spring", "autumn"];
}

/** アウターが必要な日か（25℃以上は不要、18〜24℃は最低気温15℃未満なら必要、17℃以下は必要） */
export function needsOuterForWeather(weather: OutfitWeatherInput): boolean {
  if (weather.maxTemp >= 25) return false;
  if (weather.maxTemp >= 18) return weather.minTemp < 15;
  return true;
}

/** 天気が取れない場合のアウター要否（冬だけ必要とする） */
export function needsOuterForMonth(currentSeason: Season): boolean {
  return currentSeason === "winter";
}

// 同点の並びを「同じ日なら同じ、日が変われば入れ替わる」ようにするための
// 決定的なハッシュ（FNV-1a 32bit）
function stableHash(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

type SeasonFit = "match" | "all" | "unknown" | "mismatch";

function getSeasonFit(season: string | null, suitable: Season[]): SeasonFit {
  if (season === null) return "unknown";
  if (season === "all") return "all";
  return (suitable as string[]).includes(season) ? "match" : "mismatch";
}

/**
 * 最近着ていない度合い（大きいほど優先）。
 * 2週間以上着ていない服 > 着用記録がない服 > 最近着た服 の順。
 */
function getRecencyScore(days: number | null): number {
  if (days === null) return 20;
  if (days >= 14) return 100 + Math.min(days, 365);
  return days;
}

function getRecencyReason(days: number | null): string | null {
  if (days === null) return "Re:Closetでの着用記録がまだない服";
  if (days >= 60) return "最後に着てから2か月以上";
  if (days >= 30) return "最後に着てから1か月以上";
  if (days >= 14) return "最後に着てから2週間以上";
  return null;
}

function buildReasons(
  item: OutfitItemInput,
  fit: SeasonFit,
  basis: OutfitSuggestion["basis"],
): string[] {
  // 季節一致は具体的な理由として先頭に、オールシーズンは情報量が少ないため
  // 他に理由がない場合の補足として最後に置く
  const seasonMatchReason =
    fit === "match" && item.season
      ? `${basis === "weather" ? "今日の気温" : "今の季節"}に合う${getSeasonLabel(item.season)}物`
      : null;

  return [
    seasonMatchReason,
    item.status === "candidate" ? "手放す前にもう一度" : null,
    getRecencyReason(item.daysSinceLastWorn),
    item.favorite ? "お気に入りの一着" : null,
    fit === "all" ? "季節を問わず着られる一着" : null,
  ]
    .filter((reason): reason is string => reason !== null)
    .slice(0, MAX_REASONS);
}

type ScoredItem = {
  item: OutfitItemInput;
  fit: SeasonFit;
  sortKey: number[];
};

/**
 * 並び順: 1. 気温に合う（season一致・オールシーズン > season未設定）
 *         2. 最近着ていない  3. お気に入り  4. 手放し候補  5. 日替わりの決定的な順
 */
function scoreItems(
  items: OutfitItemInput[],
  suitable: Season[],
  dateKey: string,
): ScoredItem[] {
  return items
    .map((item) => {
      const fit = getSeasonFit(item.season, suitable);
      return {
        item,
        fit,
        sortKey: [
          fit === "match" || fit === "all" ? 1 : 0,
          getRecencyScore(item.daysSinceLastWorn),
          item.favorite ? 1 : 0,
          item.status === "candidate" ? 1 : 0,
          stableHash(`${dateKey}:${item.id}`),
        ],
      };
    })
    .filter((scored) => scored.fit !== "mismatch")
    .sort((a, b) => {
      for (let i = 0; i < a.sortKey.length; i++) {
        if (a.sortKey[i] !== b.sortKey[i]) return b.sortKey[i] - a.sortKey[i];
      }
      return 0;
    });
}

export function suggestTodayOutfit({
  items,
  weather,
  currentSeason,
  dateKey,
}: {
  items: OutfitItemInput[];
  /** 天気の取得に失敗した場合はnull（月ベースの季節で判定する） */
  weather: OutfitWeatherInput | null;
  /** getCurrentSeasonJst() の値 */
  currentSeason: Season;
  /** 日本時間の今日（YYYY-MM-DD）。同じ日なら同じ結果になる */
  dateKey: string;
}): OutfitSuggestion {
  const basis = weather ? "weather" : "month";
  const suitable = weather
    ? getSuitableSeasonsForTemp(weather.maxTemp)
    : getSuitableSeasonsForMonth(currentSeason);
  const needsOuter = weather
    ? needsOuterForWeather(weather)
    : needsOuterForMonth(currentSeason);

  const eligible = items.filter((item) =>
    ELIGIBLE_STATUSES.includes(item.status),
  );
  const wornToday = eligible.filter((item) => item.daysSinceLastWorn === 0);
  // 今日・昨日着た服は新しい提案に含めない
  const suggestable = eligible.filter(
    (item) => item.daysSinceLastWorn === null || item.daysSinceLastWorn >= 2,
  );

  const pickSlot = (
    slot: OutfitSlot,
    categories: string[],
  ): OutfitPick | null => {
    // 今日すでに着た服があれば、その枠は「今日着た服」として表示する
    const worn = wornToday
      .filter((item) => categories.includes(item.category))
      .sort(
        (a, b) =>
          stableHash(`${dateKey}:${b.id}`) - stableHash(`${dateKey}:${a.id}`),
      )[0];
    if (worn) {
      return { slot, item: worn, reasons: ["今日着た服"], wornToday: true };
    }

    const best = scoreItems(
      suggestable.filter((item) => categories.includes(item.category)),
      suitable,
      dateKey,
    )[0];
    if (!best) return null;
    return {
      slot,
      item: best.item,
      reasons: buildReasons(best.item, best.fit, basis),
      wornToday: false,
    };
  };

  const picks: OutfitPick[] = [];

  const main = pickSlot("main", MAIN_CATEGORIES);
  if (main) picks.push(main);

  // ワンピースを選んだ日はボトムスを出さない
  if (main?.item.category !== "dress") {
    const bottoms = pickSlot("bottoms", ["bottoms"]);
    if (bottoms) picks.push(bottoms);
  }

  const outerWornToday = wornToday.some((item) => item.category === "outer");
  if (needsOuter || outerWornToday) {
    const outer = pickSlot("outer", ["outer"]);
    if (outer) picks.push(outer);
  }

  return { basis, needsOuter, picks };
}
