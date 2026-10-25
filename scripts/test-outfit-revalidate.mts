// 確定後に再取得する画面の一覧（lib/outfits/revalidate.ts）の自動テスト。
//
// 実行方法:
//   node --test scripts/test-outfit-revalidate.mts

import assert from "node:assert/strict";
import { test } from "node:test";
import { outfitPathsToRevalidate } from "../lib/outfits/revalidate.ts";

const all = ["/protected/looks/o1", "/protected/items/a", "/protected/items/b"];

test("confirmed は、コーデと選んだ服すべての画面", () => {
  assert.deepEqual(outfitPathsToRevalidate("confirmed", "o1", ["a", "b", "a"]), all);
});

test("unchanged も同じ（応答が失われた再送でも画面を新しくする）", () => {
  assert.deepEqual(outfitPathsToRevalidate("unchanged", "o1", ["a", "b"]), all);
});

test("stale は何も再取得しない", () => {
  assert.deepEqual(outfitPathsToRevalidate("stale", "o1", ["a", "b"]), []);
});
