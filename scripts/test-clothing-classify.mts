// クイック仕分け（lib/clothing-classify.ts）の判定・並び順・進行状態の自動テスト。
// DB・ネットワーク・ブラウザには接続しない。
//
// 実行方法:
//   node --test scripts/test-clothing-classify.mts

import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { describe, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      return nextResolve(pathToFileURL(`${repoRoot}${specifier.slice(2)}.ts`).href, context);
    }
    return nextResolve(specifier, context);
  },
});

const {
  buildCategoryUpdate,
  classifyProgressReducer,
  getCategoryClassifiedPatch,
  getClassifyDoneMessage,
  INITIAL_CLASSIFY_PROGRESS,
  isCategoryUnclassified,
  isClassifyMode,
  isSeasonUnclassified,
  isUnclassifiedFor,
  CLASSIFY_MODES,
  CLASSIFY_MODE_LABELS,
  buildTitleSuggestions,
  MAX_CLASSIFY_ITEMS,
  selectClassifyItems,
  toSeasonsArrayLiteral,
} = await import("../lib/clothing-classify.ts");
const { unclassifiedFilters, titleCountFilterSets, classifyFetchLimit } = await import(
  "../lib/clothing-unclassified-count.ts"
);
const { PHOTO_ONLY_CATEGORY, PHOTO_ONLY_TITLE } = await import(
  "../lib/clothing-options.ts"
);

const candidate = (overrides: Record<string, unknown> = {}) => ({
  id: "item-1",
  title: PHOTO_ONLY_TITLE,
  category: PHOTO_ONLY_CATEGORY,
  status: "closet",
  seasons: [] as unknown[],
  categoryClassifiedAt: null as string | null,
  subcategory: null as string | null,
  mainColor: null as string | null,
  brand: null as string | null,
  createdAt: "2026-10-01T00:00:00Z",
  ...overrides,
});

describe("isCategoryUnclassified", () => {
  test("写真だけ登録したままの服は未分類", () => {
    assert.equal(isCategoryUnclassified(candidate()), true);
  });

  test("category='other' でもタイトルを付けた服は未分類にしない", () => {
    assert.equal(
      isCategoryUnclassified(candidate({ title: "古着のベスト" })),
      false,
    );
  });

  test("写真だけ登録した服でもカテゴリを選んだら分類済み", () => {
    assert.equal(isCategoryUnclassified(candidate({ category: "tops" })), false);
  });

  test("「その他」を選んで分類した日時がある服は未分類にしない", () => {
    assert.equal(
      isCategoryUnclassified(
        candidate({ categoryClassifiedAt: "2026-10-15T00:00:00Z" }),
      ),
      false,
    );
  });

  test("分類した日時が null でも、写真だけ登録の条件を満たさなければ分類済み", () => {
    assert.equal(
      isCategoryUnclassified(candidate({ title: "ベスト", category: "other" })),
      false,
    );
  });
});

describe("isSeasonUnclassified", () => {
  test("空配列・null・不正な値だけなら未分類", () => {
    assert.equal(isSeasonUnclassified({ seasons: [] }), true);
    assert.equal(isSeasonUnclassified({ seasons: null }), true);
    assert.equal(isSeasonUnclassified({ seasons: ["all"] }), true);
  });

  test("1つでも季節があれば分類済み", () => {
    assert.equal(isSeasonUnclassified({ seasons: ["winter"] }), false);
  });
});

describe("selectClassifyItems", () => {
  test("カテゴリ: 未分類だけを新しい順に選ぶ", () => {
    const ids = selectClassifyItems("category", [
      candidate({ id: "old", createdAt: "2026-10-01T00:00:00Z" }),
      candidate({ id: "new", createdAt: "2026-10-05T00:00:00Z" }),
      candidate({ id: "named-other", title: "ベスト" }),
      candidate({ id: "tops", category: "tops" }),
      candidate({
        id: "classified-other",
        categoryClassifiedAt: "2026-10-15T00:00:00Z",
      }),
    ]);
    assert.deepEqual(ids, ["new", "old"]);
  });

  test("季節: seasons が空の服だけ（カテゴリは問わない）", () => {
    const ids = selectClassifyItems("season", [
      candidate({ id: "empty", title: "シャツ", category: "tops" }),
      candidate({ id: "set", seasons: ["spring"] }),
    ]);
    assert.deepEqual(ids, ["empty"]);
  });

  test("売却済みは対象外", () => {
    const ids = selectClassifyItems("category", [
      candidate({ id: "sold", status: "sold" }),
      candidate({ id: "listed", status: "letting_go" }),
    ]);
    assert.deepEqual(ids, ["listed"]);
  });

  test("最大10着。同じ登録日時なら服ID順", () => {
    const items = Array.from({ length: 12 }, (_, i) =>
      candidate({ id: `item-${String(i).padStart(2, "0")}` }),
    );
    const ids = selectClassifyItems("category", items);
    assert.equal(ids.length, MAX_CLASSIFY_ITEMS);
    assert.equal(ids[0], "item-00");
  });
});

describe("buildCategoryUpdate", () => {
  const now = new Date("2026-10-15T01:02:03.000Z");
  const classifiedAt = "2026-10-15T01:02:03.000Z";

  test("種類が新しいカテゴリに属していれば残す", () => {
    assert.deepEqual(buildCategoryUpdate({ subcategory: "knit" }, "tops", now), {
      category: "tops",
      subcategory: "knit",
      category_classified_at: classifiedAt,
    });
  });

  test("属さない種類は null にする", () => {
    assert.deepEqual(
      buildCategoryUpdate({ subcategory: "knit" }, "bottoms", now),
      { category: "bottoms", subcategory: null, category_classified_at: classifiedAt },
    );
    assert.deepEqual(
      buildCategoryUpdate({ subcategory: "coat" }, "shoes", now),
      { category: "shoes", subcategory: null, category_classified_at: classifiedAt },
    );
  });

  test("「その他」のままでも分類した日時を記録する", () => {
    assert.deepEqual(buildCategoryUpdate({ subcategory: null }, "other", now), {
      category: "other",
      subcategory: null,
      category_classified_at: classifiedAt,
    });
  });
});

describe("getCategoryClassifiedPatch（通常の編集画面）", () => {
  const now = new Date("2026-10-15T01:02:03.000Z");

  test("カテゴリを変えたときだけ分類した日時を記録する", () => {
    assert.deepEqual(getCategoryClassifiedPatch("other", "tops", now), {
      category_classified_at: "2026-10-15T01:02:03.000Z",
    });
    assert.deepEqual(getCategoryClassifiedPatch("tops", "other", now), {
      category_classified_at: "2026-10-15T01:02:03.000Z",
    });
  });

  test("カテゴリを変えていなければ何も追加しない", () => {
    assert.deepEqual(getCategoryClassifiedPatch("other", "other", now), {});
  });
});

test("toSeasonsArrayLiteral: 正規化した配列リテラル", () => {
  assert.equal(toSeasonsArrayLiteral([]), "{}");
  assert.equal(
    toSeasonsArrayLiteral(["winter", "spring", "spring", "bad"]),
    "{spring,winter}",
  );
});

test("isClassifyMode", () => {
  assert.equal(isClassifyMode("category"), true);
  assert.equal(isClassifyMode("season"), true);
  for (const mode of ["subcategory", "color", "title", "brand"]) {
    assert.equal(isClassifyMode(mode), true);
  }
  assert.equal(isClassifyMode("review"), false);
  assert.equal(isClassifyMode(undefined), false);
});

describe("classifyProgressReducer", () => {
  const total = 3;

  test("保存すると次へ進み、保存した服を記録する", () => {
    const state = classifyProgressReducer(INITIAL_CLASSIFY_PROGRESS, {
      type: "saved",
      itemId: "a",
      total,
    });
    assert.deepEqual(state, { index: 1, savedIds: ["a"] });
  });

  test("スキップは保存した服に数えない", () => {
    const state = classifyProgressReducer(INITIAL_CLASSIFY_PROGRESS, {
      type: "next",
      total,
    });
    assert.deepEqual(state, { index: 1, savedIds: [] });
  });

  test("戻っても保存済みの記録は消えず、選び直しても二重に数えない", () => {
    let state = classifyProgressReducer(INITIAL_CLASSIFY_PROGRESS, {
      type: "saved",
      itemId: "a",
      total,
    });
    state = classifyProgressReducer(state, { type: "back" });
    assert.deepEqual(state, { index: 0, savedIds: ["a"] });
    state = classifyProgressReducer(state, { type: "saved", itemId: "a", total });
    assert.deepEqual(state, { index: 1, savedIds: ["a"] });
  });

  test("先頭より前・最後より後には進まない", () => {
    assert.equal(
      classifyProgressReducer(INITIAL_CLASSIFY_PROGRESS, { type: "back" }).index,
      0,
    );
    const end = classifyProgressReducer(
      { index: total, savedIds: [] },
      { type: "next", total },
    );
    assert.equal(end.index, total);
  });

  test("途中で終えると最後まで進んだ扱いになり、保存した記録は残る", () => {
    const state = classifyProgressReducer(
      { index: 1, savedIds: ["a"] },
      { type: "finish", total },
    );
    assert.deepEqual(state, { index: total, savedIds: ["a"] });
  });
});

test("getClassifyDoneMessage", () => {
  assert.equal(getClassifyDoneMessage(5), "今日は5着仕分けました。少しずつで大丈夫です。");
  assert.match(getClassifyDoneMessage(0), /仕分けませんでした/);
});

test("モードの並びと見出し", () => {
  assert.deepEqual(
    [...CLASSIFY_MODES],
    ["category", "subcategory", "color", "season", "title", "brand"],
  );
  for (const mode of CLASSIFY_MODES) {
    assert.ok(CLASSIFY_MODE_LABELS[mode]);
  }
});

describe("isUnclassifiedFor", () => {
  test("category / season は今までと同じ判定", () => {
    assert.equal(isUnclassifiedFor("category", candidate()), true);
    assert.equal(isUnclassifiedFor("category", candidate({ category: "tops" })), false);
    assert.equal(isUnclassifiedFor("season", candidate()), true);
    assert.equal(isUnclassifiedFor("season", candidate({ seasons: ["summer"] })), false);
  });

  test("subcategory: 種類が null で、カテゴリに種類がある服だけ", () => {
    assert.equal(isUnclassifiedFor("subcategory", candidate({ category: "tops" })), true);
    assert.equal(isUnclassifiedFor("subcategory", candidate({ category: "outer" })), true);
    assert.equal(
      isUnclassifiedFor("subcategory", candidate({ category: "tops", subcategory: "knit" })),
      false,
    );
    // 種類のないカテゴリ（shoes・bag・other）は対象外
    for (const category of ["shoes", "bag", "other"]) {
      assert.equal(isUnclassifiedFor("subcategory", candidate({ category })), false);
    }
  });

  test("color: main_color が null の服", () => {
    assert.equal(isUnclassifiedFor("color", candidate()), true);
    assert.equal(isUnclassifiedFor("color", candidate({ mainColor: "white" })), false);
  });

  test("brand: brand が null の服", () => {
    assert.equal(isUnclassifiedFor("brand", candidate()), true);
    assert.equal(isUnclassifiedFor("brand", candidate({ brand: "UNIQLO" })), false);
  });

  test("title: 仮タイトルで、カテゴリが未分類でない服だけ", () => {
    // カテゴリ未分類（other・日時なし）は外す
    assert.equal(isUnclassifiedFor("title", candidate()), false);
    assert.equal(isUnclassifiedFor("title", candidate({ category: "tops" })), true);
    assert.equal(
      isUnclassifiedFor("title", candidate({ categoryClassifiedAt: "2026-10-15T00:00:00Z" })),
      true,
    );
    assert.equal(isUnclassifiedFor("title", candidate({ category: "tops", title: "白シャツ" })), false);
  });
});

describe("selectClassifyItems（追加モード）", () => {
  test("title: カテゴリ未分類を外して新しい順に選ぶ", () => {
    const ids = selectClassifyItems("title", [
      candidate({ id: "unsorted", createdAt: "2026-10-09T00:00:00Z" }),
      candidate({ id: "a", category: "tops", createdAt: "2026-10-01T00:00:00Z" }),
      candidate({ id: "b", category: "bag", createdAt: "2026-10-02T00:00:00Z" }),
    ]);
    assert.deepEqual(ids, ["b", "a"]);
  });

  test("subcategory / color / brand", () => {
    const items = [
      candidate({ id: "x", category: "tops" }),
      candidate({ id: "y", category: "shoes", mainColor: "black", brand: "A" }),
    ];
    assert.deepEqual(selectClassifyItems("subcategory", items), ["x"]);
    assert.deepEqual(selectClassifyItems("color", items), ["x"]);
    assert.deepEqual(selectClassifyItems("brand", items), ["x"]);
  });

  test("title は10着に絞る", () => {
    const items = Array.from({ length: 15 }, (_, i) =>
      candidate({ id: `t-${String(i).padStart(2, "0")}`, category: "tops" }),
    );
    assert.equal(selectClassifyItems("title", items).length, MAX_CLASSIFY_ITEMS);
  });
});

describe("unclassifiedFilters（6モード）", () => {
  test("既存の category / season は変えない", () => {
    assert.deepEqual(unclassifiedFilters("category"), [
      ["title", "eq", PHOTO_ONLY_TITLE],
      ["category", "eq", PHOTO_ONLY_CATEGORY],
      ["category_classified_at", "is", "null"],
    ]);
    assert.deepEqual(unclassifiedFilters("season"), [["seasons", "eq", "{}"]]);
  });

  test("subcategory: 種類が null かつ種類のあるカテゴリ", () => {
    assert.deepEqual(unclassifiedFilters("subcategory"), [
      ["subcategory", "is", "null"],
      ["category", "in", "(tops,bottoms,dress,outer)"],
    ]);
  });

  test("color / brand / title", () => {
    assert.deepEqual(unclassifiedFilters("color"), [["main_color", "is", "null"]]);
    assert.deepEqual(unclassifiedFilters("brand"), [["brand", "is", "null"]]);
    assert.deepEqual(unclassifiedFilters("title"), [["title", "eq", PHOTO_ONLY_TITLE]]);
  });

  test("title の件数は2つの条件の合計（or を使わない）", () => {
    assert.deepEqual(titleCountFilterSets(), [
      [
        ["title", "eq", PHOTO_ONLY_TITLE],
        ["category", "neq", PHOTO_ONLY_CATEGORY],
      ],
      [
        ["title", "eq", PHOTO_ONLY_TITLE],
        ["category", "eq", PHOTO_ONLY_CATEGORY],
        ["category_classified_at", "not.is", "null"],
      ],
    ]);
  });

  test("取得件数: title は多め、ほかは10着", () => {
    assert.equal(classifyFetchLimit("title"), 100);
    assert.equal(classifyFetchLimit("color"), MAX_CLASSIFY_ITEMS);
  });
});

describe("buildTitleSuggestions", () => {
  const base = { category: "tops", subcategory: null, mainColor: null, brand: null };

  test("カラー・ブランド・種類の3件", () => {
    assert.deepEqual(
      buildTitleSuggestions({
        category: "tops",
        subcategory: "shirt_blouse",
        mainColor: "white",
        brand: "UNIQLO",
      }),
      ["白のシャツ・ブラウス", "UNIQLO のシャツ・ブラウス", "シャツ・ブラウス"],
    );
  });

  test("種類がなければカテゴリの表示名を使う", () => {
    assert.deepEqual(
      buildTitleSuggestions({ ...base, category: "bottoms", mainColor: "black" }),
      ["黒のボトムス", "ボトムス"],
    );
  });

  test("ブランドだけ・何もない", () => {
    assert.deepEqual(buildTitleSuggestions({ ...base, brand: " UNIQLO " }), [
      "UNIQLO のトップス",
      "トップス",
    ]);
    assert.deepEqual(buildTitleSuggestions(base), ["トップス"]);
  });

  test("マルチカラーはそのまま使い、「その他」の色は作らない", () => {
    assert.deepEqual(
      buildTitleSuggestions({ ...base, category: "dress", subcategory: "dress", mainColor: "multi" }),
      ["マルチカラーのワンピース", "ワンピース"],
    );
    assert.deepEqual(buildTitleSuggestions({ ...base, mainColor: "other" }), ["トップス"]);
  });

  test("カテゴリ other で種類もなければ候補なし", () => {
    assert.deepEqual(
      buildTitleSuggestions({ category: "other", subcategory: null, mainColor: "white", brand: "A" }),
      [],
    );
  });

  test("種類「その他」はカテゴリ名に落とす", () => {
    assert.deepEqual(
      buildTitleSuggestions({ ...base, subcategory: "other" }),
      ["トップス"],
    );
  });

  test("最大3件・重なりなし", () => {
    const list = buildTitleSuggestions({
      category: "tops",
      subcategory: "knit",
      mainColor: "white",
      brand: "ニット",
    });
    assert.ok(list.length <= 3);
    assert.equal(new Set(list).size, list.length);
  });
});
