// 類似判定の試験（scripts/similarity-trial/core.ts）の純粋関数のテスト。
//
// 実行方法:
//   node --test scripts/test-similarity-trial.mts

import assert from "node:assert/strict";
import { test } from "node:test";

const core = await import("./similarity-trial/core.ts");

const tags = (o: Record<string, string | null> = {}) => ({
  category: null,
  subcategory: null,
  main_color: null,
  pattern: null,
  material_look: null,
  sleeve_length: null,
  layer_role: null,
  ...o,
});

test("scoreTags：一致した項目の点数を足す（null同士は一致にしない）", () => {
  const det = tags({ category: "tops", subcategory: "knit", main_color: "red", pattern: "solid" });
  const flat = tags({ category: "tops", subcategory: "knit", main_color: "blue", pattern: "solid", layer_role: null });
  assert.equal(core.scoreTags(det, flat), 3 + 3 + 1);
  assert.equal(core.scoreTags(tags(), tags()), 0);
  const all = tags({
    category: "a", subcategory: "b", main_color: "c", pattern: "d",
    material_look: "e", sleeve_length: "f", layer_role: "g",
  });
  assert.equal(core.scoreTags(all, all), 12);
});

test("rankByTags：点数の高い順、同点は id 順で安定", () => {
  const det = tags({ category: "tops", main_color: "red" });
  const flats = [
    { id: "c", tags: tags({ category: "tops", main_color: "red" }) },
    { id: "b", tags: tags({ category: "tops", main_color: "blue" }) },
    { id: "a", tags: tags({ category: "tops", main_color: "blue" }) },
    { id: "d", tags: tags({ category: "bottoms" }) },
  ];
  assert.deepEqual(core.rankByTags(det, flats), ["c", "a", "b", "d"]);
});

test("mergeRanking：AIの並び→残りはタグの順。不正な番号と重複は無視", () => {
  const cand = ["x", "y", "z"];
  const tagOrder = ["x", "y", "z", "w"];
  assert.deepEqual(core.mergeRanking([3, 1], cand, tagOrder), ["z", "x", "y", "w"]);
  assert.deepEqual(core.mergeRanking([], cand, tagOrder), tagOrder);
  assert.deepEqual(core.mergeRanking([9, 0, 2, 2, 1.5], cand, tagOrder), ["y", "x", "z", "w"]);
});

test("cropRegion：10%の余白、画像の端で切る、不正なboxはnull", () => {
  // 100x200 の画像。box は y 400-600, x 400-600（中央 20%）
  const r = core.cropRegion([400, 400, 600, 600], 100, 200);
  // 幅 20px の 10% = 2px、高さ 40px の 10% = 4px
  assert.deepEqual(r, { left: 38, top: 76, width: 24, height: 48 });
  // 端で切る
  assert.deepEqual(core.cropRegion([0, 0, 1000, 1000], 100, 200), { left: 0, top: 0, width: 100, height: 200 });
  const edge = core.cropRegion([900, 900, 1000, 1000], 100, 100);
  assert.ok(edge && edge.left + edge.width <= 100 && edge.top + edge.height <= 100);
  // 不正
  assert.equal(core.cropRegion(null, 100, 100), null);
  assert.equal(core.cropRegion([1, 2, 3], 100, 100), null);
  assert.equal(core.cropRegion([500, 500, 400, 600], 100, 100), null);
  assert.equal(core.cropRegion([0, 0, Number.NaN, 10], 100, 100), null);
  assert.equal(core.cropRegion([10, 10, 10, 20], 100, 100), null);
});

test("cacheKey：同じ入力なら同じ、どれか違えば別", () => {
  const base = { stage: "detect", model: "m", inputHash: "h", config: "c" };
  assert.equal(core.cacheKey(base), core.cacheKey({ ...base }));
  for (const k of Object.keys(base)) {
    assert.notEqual(core.cacheKey(base), core.cacheKey({ ...base, [k]: "other" }));
  }
  assert.match(core.cacheKey(base), /^[0-9a-f]{64}$/);
});

test("validateTruth：items にない similar/hidden と flats にない id はエラー", () => {
  const ok = { looks: { "a.jpg": { items: ["1", "2"], similar: ["1"], hidden: ["2"] } } };
  assert.doesNotThrow(() => core.validateTruth(ok, new Set(["1", "2", "3"])));
  assert.throws(() => core.validateTruth(ok, new Set(["1"])), /2/);
  const bad = { looks: { "a.jpg": { items: ["1"], similar: ["2"] } } };
  assert.throws(() => core.validateTruth(bad, new Set(["1", "2"])), /similar/);
  assert.throws(() => core.validateTruth({ looks: { "a.jpg": { items: ["1"], hidden: ["9"] } } }, new Set(["1"])), /hidden/);
  assert.throws(() => core.validateTruth({}, new Set()), /looks/);
});

test("scoreLook：順位は検出した服のうち一番上に置いた順位。検出の割合は category の個数で数える", () => {
  const cats: Record<string, string> = { t1: "tops", t2: "tops", b1: "bottoms" };
  const entry = { items: ["t1", "t2", "b1"], similar: ["t1"], hidden: ["b1"] };
  const detections = [{ category: "tops" }, { category: "bottoms" }];
  const rankings = [
    ["t2", "x", "t1", "b1"], // tops の検出
    ["b1", "t1", "t2", "x"], // bottoms の検出
  ];
  const s = core.scoreLook(entry, (id: string) => cats[id], detections, rankings);
  const by = Object.fromEntries(s.map((r: { id: string }) => [r.id, r]));
  assert.equal(by.t1.rank, 2); // min(3, 2)
  assert.equal(by.t2.rank, 1);
  assert.equal(by.b1.rank, 1);
  // tops は 2 着必要だが検出は 1 つ → t1 だけ検出、t2 は未検出
  assert.equal(by.t1.detected, true);
  assert.equal(by.t2.detected, false);
  assert.equal(by.b1.detected, true);
  assert.equal(by.t1.similar, true);
  assert.equal(by.b1.hidden, true);
  assert.equal(by.t2.similar, false);
});

test("rankOfItem：どの検出にも出なければ null", () => {
  assert.equal(core.rankOfItem([["a", "b"], ["c"]], "c"), 1);
  assert.equal(core.rankOfItem([["a", "b"]], "z"), null);
  assert.equal(core.rankOfItem([], "a"), null);
});

test("aggregateScores：上位1件・3件・似た服だけ・隠れた服だけの件数", () => {
  const items = [
    { id: "1", detected: true, rank: 1, similar: true, hidden: false },
    { id: "2", detected: true, rank: 3, similar: false, hidden: true },
    { id: "3", detected: false, rank: 4, similar: true, hidden: false },
    { id: "4", detected: true, rank: null, similar: false, hidden: false },
  ];
  const a = core.aggregateScores(items);
  assert.deepEqual(a, {
    n: 4, detected: 3, top1: 1, top3: 2,
    similar: { n: 2, top1: 1, top3: 1 },
    hidden: { n: 1, top1: 0, top3: 1 },
  });
});

test("tokenCost / embeddingCost：100万トークンあたりの単価で計算", () => {
  assert.ok(Math.abs(core.tokenCost("google/gemini-3.5-flash-lite", 1_000_000, 1_000_000) - 2.8) < 1e-9);
  assert.ok(Math.abs(core.tokenCost("google/gemini-3.8-flash", 2_000_000, 0) - 1.5) < 1e-9);
  assert.equal(core.tokenCost("unknown/model", 100, 100), 0);
  assert.ok(Math.abs(core.embeddingCost(10) - 0.0012) < 1e-12);
});
