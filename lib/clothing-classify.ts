import {
  getCategoryLabel,
  getColorLabel,
  getSubcategoryLabel,
  getSubcategoryOptions,
  isSubcategoryForCategory,
  normalizeSeasons,
  PHOTO_ONLY_CATEGORY,
  PHOTO_ONLY_TITLE,
} from "@/lib/clothing-options";

// ============================================================
// クイック仕分け（写真だけ登録した服などを、カードで1着ずつ分類する。
// 完全ルールベース・純粋関数。AIは使わない）
//
// - カテゴリ仕分けと季節仕分けは独立した作業。片方が終わっても、もう片方は始めない
// - 1回最大10着。1着ごとに clothing_items へ保存する（途中でやめても残る）
// - カテゴリ未分類の判定: 写真だけ登録したままの服（title=PHOTO_ONLY_TITLE かつ
//   category=PHOTO_ONLY_CATEGORY）のうち、category_classified_at（migration 018）が
//   null の服。category='other' だけでは未分類と決めつけない。
//   仕分けで「その他」を選んだ服も category_classified_at を記録するため、次回は出ない
// - 季節未分類: seasons が空配列の服
// - 種類: subcategory が null で、カテゴリに種類がある服 / カラー: main_color が null /
//   ブランド: brand が null / タイトル: 仮タイトルのまま（カテゴリ未分類の服は除く。
//   タイトルを付けるとカテゴリ仕分けの対象から外れてしまうため）
// - 見直し（closet_review_*）とは別の機能。見直しの記録には触れない
// ============================================================

export const MAX_CLASSIFY_ITEMS = 10;

export const CLASSIFY_MODES = [
  "category",
  "subcategory",
  "color",
  "season",
  "title",
  "brand",
] as const;

export type ClassifyMode = (typeof CLASSIFY_MODES)[number];

export const CLASSIFY_MODE_LABELS: Record<ClassifyMode, string> = {
  category: "カテゴリを仕分ける",
  subcategory: "種類を仕分ける",
  color: "カラーを仕分ける",
  season: "シーズンを仕分ける",
  title: "タイトルを付ける",
  brand: "ブランドを入れる",
};

/** 仕分けの対象にする服の状態（売却済みは対象外） */
export const CLASSIFY_STATUSES = ["closet", "candidate", "letting_go"] as const;

export function isClassifyMode(value: unknown): value is ClassifyMode {
  return (CLASSIFY_MODES as readonly unknown[]).includes(value);
}

export function isClassifyStatus(status: string): boolean {
  return (CLASSIFY_STATUSES as readonly string[]).includes(status);
}

/** カテゴリが未分類か（写真だけ登録したままで、カテゴリを分類した記録がない服） */
export function isCategoryUnclassified(item: {
  title: string;
  category: string;
  categoryClassifiedAt: string | null;
}): boolean {
  return (
    item.title === PHOTO_ONLY_TITLE &&
    item.category === PHOTO_ONLY_CATEGORY &&
    item.categoryClassifiedAt === null
  );
}

/** 季節が未分類か（春・夏・秋・冬がひとつも設定されていない） */
export function isSeasonUnclassified(item: {
  seasons: readonly unknown[] | null | undefined;
}): boolean {
  return normalizeSeasons(item.seasons).length === 0;
}

export type ClassifyCandidate = {
  id: string;
  title: string;
  category: string;
  status: string;
  seasons: readonly unknown[] | null;
  categoryClassifiedAt: string | null;
  subcategory: string | null;
  mainColor: string | null;
  brand: string | null;
  createdAt: string;
};

/** 種類が未設定で、種類を選べるカテゴリの服か */
export function isSubcategoryUnclassified(item: {
  category: string;
  subcategory: string | null;
}): boolean {
  return item.subcategory === null && getSubcategoryOptions(item.category).length > 0;
}

/** タイトルが仮のままで、カテゴリは未分類でない服か */
export function isTitleUnclassified(item: {
  title: string;
  category: string;
  categoryClassifiedAt: string | null;
}): boolean {
  return item.title === PHOTO_ONLY_TITLE && !isCategoryUnclassified(item);
}

/** モードごとの「未分類」の判定 */
export function isUnclassifiedFor(mode: ClassifyMode, item: ClassifyCandidate): boolean {
  switch (mode) {
    case "category":
      return isCategoryUnclassified(item);
    case "subcategory":
      return isSubcategoryUnclassified(item);
    case "color":
      return item.mainColor === null;
    case "season":
      return isSeasonUnclassified(item);
    case "title":
      return isTitleUnclassified(item);
    case "brand":
      return item.brand === null;
  }
}

/**
 * 仕分ける服のIDを、見せる順に最大 limit 着選ぶ。
 * 並び順: 登録が新しい順（写真をまとめて登録した直後の服が先）→ 服ID
 */
export function selectClassifyItems(
  mode: ClassifyMode,
  items: ClassifyCandidate[],
  limit = MAX_CLASSIFY_ITEMS,
): string[] {
  return items
    .filter((item) => isClassifyStatus(item.status))
    .filter((item) => isUnclassifiedFor(mode, item))
    .sort((a, b) => {
      const aTime = new Date(a.createdAt).getTime();
      const bTime = new Date(b.createdAt).getTime();
      if (aTime !== bTime) return bTime - aTime;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    })
    .slice(0, limit)
    .map((item) => item.id);
}

/**
 * クイック仕分けでカテゴリを選んだときの保存値。今の種類が新しいカテゴリに
 * 属していれば残し、属さなければ null にする（種類とカテゴリの整合性を保つ）。
 * 同じカテゴリ（「その他」のままなど）でも、分類した日時を記録する
 */
export function buildCategoryUpdate(
  current: { subcategory: string | null },
  category: string,
  now: Date,
): {
  category: string;
  subcategory: string | null;
  category_classified_at: string;
} {
  return {
    category,
    subcategory: isSubcategoryForCategory(category, current.subcategory)
      ? current.subcategory
      : null,
    category_classified_at: now.toISOString(),
  };
}

/**
 * 通常の編集画面で保存するときに追加する値。カテゴリを変えたときだけ
 * 分類した日時を記録する（変えていなければ何も追加しない）
 */
export function getCategoryClassifiedPatch(
  initialCategory: string,
  category: string,
  now: Date,
): { category_classified_at?: string } {
  return initialCategory !== category
    ? { category_classified_at: now.toISOString() }
    : {};
}

/**
 * タイトルの候補（最大3件、重なりなし）。
 * 1. カラー＋種類（なければカテゴリ） 2. ブランド＋種類 3. 種類だけ。
 * 種類もカテゴリ名もない（カテゴリ「その他」で種類なし）ときは候補を作らない
 */
export function buildTitleSuggestions(item: {
  category: string;
  subcategory: string | null;
  mainColor: string | null;
  brand: string | null;
}): string[] {
  // 種類「その他」は名前として弱いので、カテゴリ名に落とす
  const noun =
    item.subcategory && item.subcategory !== "other"
      ? getSubcategoryLabel(item.subcategory)
      : item.category !== PHOTO_ONLY_CATEGORY
        ? getCategoryLabel(item.category)
        : null;
  if (!noun) return [];

  const candidates: string[] = [];
  if (item.mainColor && item.mainColor !== "other") {
    candidates.push(`${getColorLabel(item.mainColor)}の${noun}`);
  }
  const brand = item.brand?.trim();
  if (brand) candidates.push(`${brand} の${noun}`);
  candidates.push(noun);
  return [...new Set(candidates)].slice(0, 3);
}

/**
 * seasons 列の値を PostgREST の配列リテラルにする（保存前の値の一致確認に使う）。
 * 値は春・夏・秋・冬だけに正規化されるため、エスケープは不要
 */
export function toSeasonsArrayLiteral(seasons: readonly unknown[]): string {
  return `{${normalizeSeasons(seasons).join(",")}}`;
}

// ============================================================
// 仕分けの進行状態
// - index: 今見ている服の位置。items.length なら最後まで進んだ（結果を表示）
// - savedIds: このセッションで保存した服。「その他」を選んだ服も含めて、
//   同じセッションでは未分類として再び出さない（服の一覧は開始時に固定する）
// - 戻る: 前の服を再表示するだけ。保存済みの分類は取り消さない
// ============================================================

export type ClassifyProgress = {
  index: number;
  savedIds: string[];
};

export const INITIAL_CLASSIFY_PROGRESS: ClassifyProgress = {
  index: 0,
  savedIds: [],
};

export type ClassifyAction =
  | { type: "saved"; itemId: string; total: number }
  | { type: "next"; total: number }
  | { type: "back" }
  | { type: "finish"; total: number };

export function classifyProgressReducer(
  state: ClassifyProgress,
  action: ClassifyAction,
): ClassifyProgress {
  switch (action.type) {
    case "saved":
      return {
        index: Math.min(state.index + 1, action.total),
        savedIds: state.savedIds.includes(action.itemId)
          ? state.savedIds
          : [...state.savedIds, action.itemId],
      };
    case "next":
      return { ...state, index: Math.min(state.index + 1, action.total) };
    case "back":
      return { ...state, index: Math.max(state.index - 1, 0) };
    case "finish":
      return { ...state, index: action.total };
  }
}

/** 終わったときの軽い達成表示 */
export function getClassifyDoneMessage(savedCount: number): string {
  if (savedCount === 0) {
    return "今回は仕分けませんでした。またいつでも続きからできます。";
  }
  return `今日は${savedCount}着仕分けました。少しずつで大丈夫です。`;
}
