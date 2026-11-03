// ブランドの候補（lib/brand-suggestions.ts）の自動テスト。
//
// 実行方法:
//   node --test scripts/test-brand-suggestions.mts

import assert from "node:assert/strict";
import { test } from "node:test";

const { buildBrandSuggestions, filterBrandSuggestions, MAX_BRAND_SUGGESTIONS } = await import(
  "../lib/brand-suggestions.ts"
);

test("空・null・空白だけは除く", () => {
  assert.deepEqual(buildBrandSuggestions([null, "", "  ", undefined, "UNIQLO"]), ["UNIQLO"]);
});

test("前後の空白を取り、大文字小文字を区別せず重ねる（多い方の表記を残す）", () => {
  assert.deepEqual(
    buildBrandSuggestions([" Uniqlo ", "Uniqlo", "UNIQLO", "ZARA"]),
    ["Uniqlo", "ZARA"],
  );
  // 表記の数が同じなら、名前順で先のもの
  assert.deepEqual(buildBrandSuggestions(["uniqlo", "UNIQLO"]), ["UNIQLO"]);
});

test("よく使う順、同じ数なら名前順", () => {
  assert.deepEqual(
    buildBrandSuggestions(["b", "a", "c", "c", "b", "d"]),
    ["b", "c", "a", "d"],
  );
});

test("最大30件", () => {
  const brands = Array.from({ length: 40 }, (_, i) => `brand${String(i).padStart(2, "0")}`);
  const result = buildBrandSuggestions(brands);
  assert.equal(MAX_BRAND_SUGGESTIONS, 30);
  assert.equal(result.length, 30);
  assert.equal(result[0], "brand00");
});

test("何もなければ空の配列", () => {
  assert.deepEqual(buildBrandSuggestions([]), []);
});

test("filterBrandSuggestions: 欄が空なら先頭から最大8件", () => {
  const list = Array.from({ length: 12 }, (_, i) => `b${i}`);
  assert.deepEqual(filterBrandSuggestions(list, ""), list.slice(0, 8));
  assert.deepEqual(filterBrandSuggestions(list, "   "), list.slice(0, 8));
});

test("filterBrandSuggestions: 入れた文字を含むものを大文字小文字無視で（並びは保つ）", () => {
  assert.deepEqual(
    filterBrandSuggestions(["UNIQLO", "ZARA", "Uni Select", "GU"], "uni"),
    ["UNIQLO", "Uni Select"],
  );
});

test("filterBrandSuggestions: 完全一致だけなら出さない、ほかにあれば残す", () => {
  assert.deepEqual(filterBrandSuggestions(["ZARA"], "zara"), []);
  assert.deepEqual(filterBrandSuggestions(["ZARA", "ZARA HOME"], "zara"), ["ZARA HOME"]);
});

test("filterBrandSuggestions: 絞り込みも最大8件、該当なしは空", () => {
  const list = Array.from({ length: 12 }, (_, i) => `ab${i}`);
  assert.equal(filterBrandSuggestions(list, "ab").length, 8);
  assert.deepEqual(filterBrandSuggestions(list, "xyz"), []);
});
