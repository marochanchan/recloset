// 今日のコーデ候補（lib/outfit-suggestion.ts）の自動テスト。
// DB・ネットワーク・ブラウザには接続しない（純粋関数だけを呼ぶ）。
//
// 実行方法:
//   node --test scripts/test-outfit-suggestion.mts

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
  estimateWarmthFromSeasons,
  getTargetWarmth,
  needsOuterForWeather,
  suggestTodayOutfit,
} = await import("../lib/outfit-suggestion.ts");

type Item = Parameters<typeof suggestTodayOutfit>[0]["items"][number];

function item(
  id: string,
  category: string,
  seasons: string[],
  daysSinceLastWorn: number | null,
  extra: Partial<Item> = {},
): Item {
  return {
    id,
    title: id,
    brand: null,
    category,
    seasons,
    status: "closet",
    favorite: false,
    daysSinceLastWorn,
    imagePath: null,
    ...extra,
  };
}

const DATE = "2026-10-15";

function suggest(
  items: Item[],
  weather: { maxTemp: number; minTemp: number } | null,
  dateKey = DATE,
  currentSeason: "spring" | "summer" | "autumn" | "winter" = "autumn",
) {
  return suggestTodayOutfit({ items, weather, currentSeason, dateKey });
}

function pickOf(result: ReturnType<typeof suggest>, slot: string) {
  return result.picks.find((pick) => pick.slot === slot);
}

// 冬専用のアウターほど長く着ていない（従来は未着用期間だけで冬物が勝っていた）
const OUTERS = [
  item("down", "outer", ["winter"], 200),
  item("trench", "outer", ["spring", "autumn"], 40),
  item("wool", "outer", ["autumn", "winter"], 40),
];
const BASE = [
  item("tee", "tops", ["summer"], 20),
  item("cardigan", "tops", ["spring", "autumn"], 30),
  item("knit", "tops", ["winter"], 150),
  item("denim", "bottoms", ["spring", "summer", "autumn", "winter"], 20),
];

describe("暖かさの推定と目安", () => {
  test("季節タグから大まかに推定する（オールシーズン・未設定はnull）", () => {
    assert.equal(estimateWarmthFromSeasons(["winter"]), 3);
    assert.equal(estimateWarmthFromSeasons(["autumn", "winter"]), 2);
    assert.equal(estimateWarmthFromSeasons(["spring", "autumn"]), 1);
    assert.equal(estimateWarmthFromSeasons(["summer"]), 0);
    assert.equal(estimateWarmthFromSeasons(["spring", "summer", "autumn", "winter"]), null);
    assert.equal(estimateWarmthFromSeasons([]), null);
  });

  test("最高気温ごとの目安", () => {
    assert.equal(getTargetWarmth(27), 0);
    assert.equal(getTargetWarmth(22), 1);
    assert.equal(getTargetWarmth(17), 1);
    assert.equal(getTargetWarmth(12), 2);
    assert.equal(getTargetWarmth(8), 3);
  });
});

describe("アウター", () => {
  test("1. 最高17℃・最低11℃：春秋物が冬専用より優先される", () => {
    const result = suggest([...BASE, ...OUTERS], { maxTemp: 17, minTemp: 11 });
    assert.equal(pickOf(result, "outer")?.item.id, "trench");
    assert.deepEqual(pickOf(result, "outer")?.reasons[0], "最高17℃。軽めのアウターを");
  });

  test("2. 最高8℃・最低2℃：冬物のアウターが優先される", () => {
    const result = suggest([...BASE, ...OUTERS], { maxTemp: 8, minTemp: 2 });
    assert.equal(pickOf(result, "outer")?.item.id, "down");
    assert.equal(pickOf(result, "outer")?.reasons[0], "最低2℃。暖かいアウターを");
  });

  test("3. 最高22℃・最低13℃：軽めの羽織りが優先される", () => {
    const result = suggest([...BASE, ...OUTERS], { maxTemp: 22, minTemp: 13 });
    assert.equal(result.needsOuter, true);
    assert.equal(pickOf(result, "outer")?.item.id, "trench");
    assert.equal(pickOf(result, "outer")?.reasons[0], "朝晩は13℃。軽めの羽織りを");
  });

  test("4. 最高27℃：アウター不要", () => {
    const result = suggest([...BASE, ...OUTERS], { maxTemp: 27, minTemp: 21 });
    assert.equal(result.needsOuter, false);
    assert.equal(pickOf(result, "outer"), undefined);
  });

  test("アウター要否の判定は従来どおり", () => {
    assert.equal(needsOuterForWeather({ maxTemp: 25, minTemp: 10 }), false);
    assert.equal(needsOuterForWeather({ maxTemp: 22, minTemp: 15 }), false);
    assert.equal(needsOuterForWeather({ maxTemp: 22, minTemp: 14 }), true);
    assert.equal(needsOuterForWeather({ maxTemp: 17, minTemp: 12 }), true);
  });

  test("目安に合う服がないときは、軽め・暖かいと断定しない", () => {
    const result = suggest([...BASE, item("down", "outer", ["winter"], 200)], {
      maxTemp: 17,
      minTemp: 11,
    });
    assert.equal(pickOf(result, "outer")?.item.id, "down");
    assert.equal(pickOf(result, "outer")?.reasons[0], "最低11℃。羽織れるものがあると安心");
  });

  test("理由は最大2件で、季節の理由と重ねない", () => {
    for (const weather of [
      { maxTemp: 22, minTemp: 13 },
      { maxTemp: 17, minTemp: 11 },
      { maxTemp: 12, minTemp: 5 },
      { maxTemp: 8, minTemp: 2 },
    ]) {
      const outer = pickOf(suggest([...BASE, ...OUTERS], weather), "outer");
      assert.ok(outer);
      assert.ok(outer.reasons.length <= 2);
      assert.ok(!outer.reasons.some((reason) => reason.startsWith("今日の気温に合う")));
    }
  });
});

describe("トップス", () => {
  test("最高10℃以上では、冬だけの服が常に最優先にはならない", () => {
    const at17 = suggest(BASE, { maxTemp: 17, minTemp: 11 });
    assert.equal(pickOf(at17, "main")?.item.id, "cardigan");
  });

  test("最高8℃では冬物が優先される", () => {
    const result = suggest(BASE, { maxTemp: 8, minTemp: 2 });
    assert.equal(pickOf(result, "main")?.item.id, "knit");
  });

  test("同じ暖かさなら、長く着ていない服が優先される（Re:Closetの見直しの価値を維持）", () => {
    const result = suggest(
      [item("old", "tops", ["spring", "autumn"], 90), item("recent", "tops", ["spring", "autumn"], 5)],
      { maxTemp: 20, minTemp: 16 },
    );
    assert.equal(pickOf(result, "main")?.item.id, "old");
  });
});

describe("ローテーション", () => {
  const SIMILAR = [
    item("a", "tops", ["spring", "autumn"], 40),
    item("b", "tops", ["spring", "autumn"], 45),
    item("c", "tops", ["spring", "autumn"], 50),
    item("d", "tops", ["spring", "autumn"], 55),
  ];

  test("5. 同じ日・同じ入力なら同じ結果", () => {
    const weather = { maxTemp: 20, minTemp: 16 };
    assert.deepEqual(suggest(SIMILAR, weather), suggest(SIMILAR, weather));
  });

  test("6. 日付を変えると、同程度の候補が入れ替わる", () => {
    const picked = new Set<string>();
    for (let day = 1; day <= 14; day++) {
      const dateKey = `2026-10-${String(day).padStart(2, "0")}`;
      const id = pickOf(suggest(SIMILAR, { maxTemp: 20, minTemp: 16 }, dateKey), "main")?.item.id;
      if (id) picked.add(id);
    }
    assert.ok(picked.size >= 2, `picked: ${[...picked].join(",")}`);
  });
});

describe("少ない・未設定・天気なし", () => {
  test("7. 服が0着・1着でも壊れない", () => {
    assert.deepEqual(suggest([], { maxTemp: 10, minTemp: 2 }).picks, []);
    const one = suggest([item("only", "outer", [], null)], { maxTemp: 10, minTemp: 2 });
    assert.equal(pickOf(one, "outer")?.item.id, "only");
  });

  test("7. 季節未設定だけでも提案できる（季節が合う服があればそちらが先）", () => {
    const unknownOnly = suggest(
      [item("u-top", "tops", [], null), item("u-bottom", "bottoms", [], null)],
      { maxTemp: 30, minTemp: 24 },
    );
    assert.equal(unknownOnly.picks.length, 2);
    const mixed = suggest(
      [item("u-top", "tops", [], 200), item("summer-top", "tops", ["summer"], 3)],
      { maxTemp: 30, minTemp: 24 },
    );
    assert.equal(pickOf(mixed, "main")?.item.id, "summer-top");
  });

  test("7. 天気なしは従来どおり月ベース（冬はアウターあり）", () => {
    const autumn = suggest([...BASE, ...OUTERS], null, DATE, "autumn");
    assert.equal(autumn.basis, "month");
    assert.equal(autumn.needsOuter, false);
    const winter = suggest([...BASE, ...OUTERS], null, DATE, "winter");
    assert.equal(winter.needsOuter, true);
    assert.ok(pickOf(winter, "outer"));
    assert.ok(!pickOf(winter, "outer")?.reasons.some((reason) => reason.includes("℃")));
  });
});

describe("着用記録", () => {
  test("8. 昨日・今日着た服は新しい提案に含めない（今日着た服は「今日着た服」として表示）", () => {
    const result = suggest(
      [
        item("today", "tops", ["spring", "autumn"], 0),
        item("yesterday", "bottoms", ["spring", "autumn"], 1),
        item("other-bottom", "bottoms", ["spring", "autumn"], 30),
      ],
      { maxTemp: 20, minTemp: 16 },
    );
    const main = pickOf(result, "main");
    assert.equal(main?.item.id, "today");
    assert.equal(main?.wornToday, true);
    assert.deepEqual(main?.reasons, ["今日着た服"]);
    assert.equal(pickOf(result, "bottoms")?.item.id, "other-bottom");
    assert.ok(!result.picks.some((pick) => pick.item.id === "yesterday"));
  });

  test("出品中・売却済みは提案しない", () => {
    const result = suggest(
      [item("sold", "tops", ["spring", "autumn"], 90, { status: "sold" }), item("ok", "tops", ["spring", "autumn"], 5)],
      { maxTemp: 20, minTemp: 16 },
    );
    assert.equal(pickOf(result, "main")?.item.id, "ok");
  });
});
