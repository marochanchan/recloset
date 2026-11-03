// 着画の一覧・編集まわりの純粋な関数（lib/outfits/looks.ts）の自動テスト。
//
// 実行方法:
//   node --test scripts/test-outfit-looks.mts

import assert from "node:assert/strict";
import { test } from "node:test";
import { diffItemIds, firstPhotoByOutfit, sortLooks } from "../lib/outfits/looks.ts";

test("sortLooks は worn_on の新しい順、同じ日は created_at の新しい順", () => {
  const rows = [
    { id: "a", worn_on: "2026-11-01", created_at: "2026-11-01T10:00:00Z" },
    { id: "b", worn_on: "2026-11-03", created_at: "2026-11-03T08:00:00Z" },
    { id: "c", worn_on: "2026-11-03", created_at: "2026-11-03T09:00:00Z" },
  ];
  assert.deepEqual(sortLooks(rows).map((r) => r.id), ["c", "b", "a"]);
  // 元の配列は変えない
  assert.deepEqual(rows.map((r) => r.id), ["a", "b", "c"]);
});

test("firstPhotoByOutfit は sort_order、同じなら created_at の最初の1枚", () => {
  const map = firstPhotoByOutfit([
    { outfit_id: "o1", provider_asset_id: "late", sort_order: 1, created_at: "2026-11-01T00:00:00Z" },
    { outfit_id: "o1", provider_asset_id: "first", sort_order: 0, created_at: "2026-11-02T00:00:00Z" },
    { outfit_id: "o1", provider_asset_id: "first-earlier", sort_order: 0, created_at: "2026-11-01T00:00:00Z" },
    { outfit_id: "o2", provider_asset_id: "x", sort_order: 0, created_at: "2026-11-01T00:00:00Z" },
  ]);
  assert.equal(map.get("o1"), "first-earlier");
  assert.equal(map.get("o2"), "x");
  assert.equal(map.get("o3"), undefined);
});

test("diffItemIds は足した服・外した服・変わったかを返す", () => {
  const d = diffItemIds(["a", "b", "c"], ["b", "c", "d", "d"]);
  assert.deepEqual(d.added, ["d"]);
  assert.deepEqual(d.removed, ["a"]);
  assert.equal(d.changed, true);
});

test("diffItemIds は順番だけの違いでは changed にならない", () => {
  const d = diffItemIds(["a", "b"], ["b", "a"]);
  assert.equal(d.changed, false);
  assert.deepEqual(d.added, []);
  assert.deepEqual(d.removed, []);
});
