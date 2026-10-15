import {
  getSeasonLabel,
  isAllSeasons,
  normalizeSeasons,
} from "@/lib/clothing-options";

// ============================================================
// 今日のコーデ候補（完全ルールベース・純粋関数）
//
// 天気（今日の最高/最低気温）と、自分の服のseasons・status・着用履歴から、
// トップス（またはワンピース）・ボトムス・必要な日だけアウターを1着ずつ選ぶ。
// 色や形の相性を判断するものではなく、「今日着る服をクローゼットから
// 再発見する候補」として、選んだ理由を実データから説明できる形で返す。
// 服の暖かさは季節タグからの大まかな推定だけを使い、名前（title）からは推測しない。
// ============================================================

type Season = "spring" | "summer" | "autumn" | "winter";

export type OutfitSlot = "main" | "bottoms" | "outer";

export type OutfitItemInput = {
  id: string;
  title: string;
  brand: string | null;
  category: string;
  /** 着られる季節（migration 012）。空配列は未設定、4つすべてはオールシーズン */
  seasons: string[];
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
 * 今日の最高気温に合う季節。春と秋は近いグループとして扱い、
 * 境界の気温帯では隣の季節も含める。
 * オールシーズン（4季節すべて）の服は常に対象（ここでは返さず別扱い）。
 */
export function getSuitableSeasonsForTemp(maxTemp: number): Season[] {
  if (maxTemp >= 25) return ["summer"];
  if (maxTemp >= 18) return ["spring", "autumn", "summer"];
  if (maxTemp >= 10) return ["spring", "autumn", "winter"];
  return ["winter", "autumn"];
}

/**
 * 服の暖かさの目安（0=夏物 … 3=冬物）。季節タグからの大まかな推定で、
 * 服の厚さを確定するものではない
 */
export type Warmth = 0 | 1 | 2 | 3;

/**
 * 季節タグから暖かさを推定する。
 * 冬だけ → 3 / 冬と春・秋（または夏） → 2 / 春・秋（冬なし） → 1 / 夏だけ → 0。
 * オールシーズン・未設定は推定できないためnull
 */
export function estimateWarmthFromSeasons(seasons: string[]): Warmth | null {
  const normalized = normalizeSeasons(seasons);
  if (normalized.length === 0 || isAllSeasons(normalized)) return null;
  const hasWinter = normalized.includes("winter");
  const hasMid = normalized.includes("spring") || normalized.includes("autumn");
  const hasSummer = normalized.includes("summer");
  if (hasWinter) return hasMid || hasSummer ? 2 : 3;
  return hasMid ? 1 : 0;
}

/**
 * 今日の最高気温に合う暖かさの目安。
 * 25℃以上 → 0 / 18〜24℃ → 1 / 14〜17℃ → 1 / 10〜13℃ → 2 / 9℃以下 → 3。
 * 10〜17℃でも冬物が無条件で先にならないよう、14℃以上は春秋物を目安にする
 */
export function getTargetWarmth(maxTemp: number): Warmth {
  if (maxTemp >= 25) return 0;
  if (maxTemp >= 14) return 1;
  if (maxTemp >= 10) return 2;
  return 3;
}

// オールシーズン・季節未設定の服は暖かさを推定できないため、目安から「1段階ずれ」として扱う
const UNKNOWN_WARMTH_DISTANCE = 1;

function getWarmthDistance(item: OutfitItemInput, target: Warmth): number {
  const warmth = estimateWarmthFromSeasons(item.seasons);
  return warmth === null ? UNKNOWN_WARMTH_DISTANCE : Math.abs(warmth - target);
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

// 服の季節（複数）と、今日に合う季節が1つでも重なれば「合う」
function getSeasonFit(seasons: string[], suitable: Season[]): SeasonFit {
  const normalized = normalizeSeasons(seasons);
  if (normalized.length === 0) return "unknown";
  if (isAllSeasons(normalized)) return "all";
  return normalized.some((season) => (suitable as string[]).includes(season))
    ? "match"
    : "mismatch";
}

/**
 * 最近着ていない度合いの段階（大きいほど優先）。
 * 2か月以上 > 1か月以上 > 2週間以上 > 着用記録がない > 最近着た の順。
 * 段階にまとめ、同じ段階の中は日付で入れ替わるようにする（毎日同じ服にならないように）
 */
function getRecencyBucket(days: number | null): number {
  if (days === null) return 2;
  if (days >= 60) return 5;
  if (days >= 30) return 4;
  if (days >= 14) return 3;
  return 1;
}

function getRecencyReason(days: number | null): string | null {
  if (days === null) return "Re:Closetでの着用記録がまだない服";
  if (days >= 60) return "最後に着てから2か月以上";
  if (days >= 30) return "最後に着てから1か月以上";
  if (days >= 14) return "最後に着てから2週間以上";
  return null;
}

/**
 * アウターを提案する理由（今日の気温から）。服の厚さは断定せず、今日の気温に対する目安を伝える。
 * 選んだ服の推定と目安が合わない（より合う服がない）場合は、軽め・暖かいとは書かない
 */
function getOuterWeatherReason(
  weather: OutfitWeatherInput,
  target: Warmth,
  warmthMatches: boolean,
): string {
  const max = Math.round(weather.maxTemp);
  const min = Math.round(weather.minTemp);
  if (!warmthMatches) return `最低${min}℃。羽織れるものがあると安心`;
  if (target >= 3) return `最低${min}℃。暖かいアウターを`;
  if (target === 2) return `最高${max}℃。しっかりめのアウターも候補に`;
  if (max >= 18) return `朝晩は${min}℃。軽めの羽織りを`;
  return `最高${max}℃。軽めのアウターを`;
}

function buildReasons(
  item: OutfitItemInput,
  fit: SeasonFit,
  basis: OutfitSuggestion["basis"],
  suitable: Season[],
  /** アウターのとき、今日の気温からの理由（先頭に置き、季節の理由は重ねない） */
  outerWeatherReason: string | null = null,
): string[] {
  // 季節一致は具体的な理由として先頭に、オールシーズンは情報量が少ないため
  // 他に理由がない場合の補足として最後に置く。
  // 複数季節の服は、今日に合う季節だけを理由に書く（例: 「春・秋物」）
  const matchedSeasons = normalizeSeasons(item.seasons).filter((season) =>
    (suitable as string[]).includes(season),
  );
  const seasonMatchReason =
    fit === "match" && matchedSeasons.length > 0
      ? `${basis === "weather" ? "今日の気温" : "今の季節"}に合う${matchedSeasons.map(getSeasonLabel).join("・")}物`
      : null;

  return [
    outerWeatherReason ?? seasonMatchReason,
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
 * 並び順: 1. 季節が合う（season一致・オールシーズン > season未設定）
 *         2. 今日の気温に対する暖かさの近さ（天気が取れた日だけ）
 *         3. 最近着ていない段階  4. お気に入り  5. 手放し候補  6. 日替わりの決定的な順
 * 季節が明らかに合わない服は除外する
 */
function scoreItems(
  items: OutfitItemInput[],
  suitable: Season[],
  dateKey: string,
  targetWarmth: Warmth | null,
): ScoredItem[] {
  return items
    .map((item) => {
      const fit = getSeasonFit(item.seasons, suitable);
      return {
        item,
        fit,
        sortKey: [
          fit === "match" || fit === "all" ? 1 : 0,
          targetWarmth === null ? 0 : -getWarmthDistance(item, targetWarmth),
          getRecencyBucket(item.daysSinceLastWorn),
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
  // 暖かさの目安は天気が取れた日だけ使う（月ベースのときは従来どおり季節だけで選ぶ）
  const targetWarmth = weather ? getTargetWarmth(weather.maxTemp) : null;

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
      targetWarmth,
    )[0];
    if (!best) return null;
    const outerWeatherReason =
      slot === "outer" && weather && targetWarmth !== null
        ? getOuterWeatherReason(
            weather,
            targetWarmth,
            estimateWarmthFromSeasons(best.item.seasons) === targetWarmth,
          )
        : null;
    return {
      slot,
      item: best.item,
      reasons: buildReasons(
        best.item,
        best.fit,
        basis,
        suitable,
        outerWeatherReason,
      ),
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
