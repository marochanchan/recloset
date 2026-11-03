// 服の表示名（lib/clothing-display-title.ts）の自動テスト。
//
// 実行方法:
//   node --test scripts/test-clothing-display-title.mts

import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";
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

const { displayClothingTitle } = await import("../lib/clothing-display-title.ts");

const TEMP = "写真から登録した服";

test("仮タイトルでカテゴリ未分類なら「未仕分け」", () => {
  assert.equal(
    displayClothingTitle({
      title: TEMP,
      category: "other",
      subcategory: null,
      categoryClassifiedAt: null,
    }),
    "未仕分け",
  );
});

test("仮タイトルで仕分け済みなら、種類があれば種類の表示名", () => {
  assert.equal(
    displayClothingTitle({
      title: TEMP,
      category: "tops",
      subcategory: "tshirt",
      categoryClassifiedAt: "2026-11-03T00:00:00Z",
    }),
    "Tシャツ",
  );
});

test("仮タイトルで仕分け済み、種類がなければカテゴリの表示名", () => {
  assert.equal(
    displayClothingTitle({
      title: TEMP,
      category: "tops",
      subcategory: null,
      categoryClassifiedAt: "2026-11-03T00:00:00Z",
    }),
    "トップス",
  );
  // 「その他」を選んで仕分け済みの服
  assert.equal(
    displayClothingTitle({
      title: TEMP,
      category: "other",
      subcategory: null,
      categoryClassifiedAt: "2026-11-03T00:00:00Z",
    }),
    "その他",
  );
});

test("仮タイトルでカテゴリが other 以外なら、仕分けの記録がなくても分類済み扱い", () => {
  assert.equal(
    displayClothingTitle({
      title: TEMP,
      category: "bag",
      subcategory: null,
      categoryClassifiedAt: null,
    }),
    "バッグ",
  );
});

test("仮タイトルでなければ、そのままタイトル", () => {
  assert.equal(
    displayClothingTitle({
      title: "白いシャツ",
      category: "tops",
      subcategory: "shirt",
      categoryClassifiedAt: null,
    }),
    "白いシャツ",
  );
});
