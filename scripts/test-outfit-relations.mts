// つながりの計算（lib/outfits/relations.ts, dates.ts）の自動テスト。純粋な関数だけなので I/O はない。
//
// 実行方法:
//   node --test scripts/test-outfit-relations.mts

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

const { aggregatePartners, layoutRadialLines } = await import("../lib/outfits/relations.ts");
const { jstTodayIsoDate } = await import("../lib/outfits/dates.ts");

function row(item_a: string, item_b: string, month: string, outfit_count: number, last_worn_on: string | null) {
  return { item_a, item_b, month, outfit_count, together_days: outfit_count, last_worn_on };
}

test("aggregatePartners：item_a と item_b のどちらにいても相手として数え、月をまたいで足す", () => {
  const rows = [
    row("D", "T", "2026-09", 2, "2026-09-20"),
    row("D", "T", "2026-10", 3, "2026-10-22"),
    row("G", "T", "2026-10", 1, "2026-10-01"),
    row("A", "B", "2026-10", 9, "2026-10-02"), // T と無関係の行は数えない
  ];
  assert.deepEqual(aggregatePartners(rows, "T"), [
    { itemId: "D", outfitCount: 5, lastWornOn: "2026-10-22" },
    { itemId: "G", outfitCount: 1, lastWornOn: "2026-10-01" },
  ]);
});

test("aggregatePartners：同じ回数なら最後に着た日が新しい方が先", () => {
  const rows = [
    row("B", "T", "2026-10", 2, "2026-10-01"),
    row("C", "T", "2026-10", 2, "2026-10-05"),
    row("A", "T", "2026-10", 2, null),
  ];
  assert.deepEqual(
    aggregatePartners(rows, "T").map((p) => p.itemId),
    ["C", "B", "A"],
  );
});

test("layoutRadialLines：1件目は真上（x≈0, y=-innerRadius）、max を超えた分は出さない", () => {
  const partners = [
    { itemId: "A", outfitCount: 5, lastWornOn: null },
    { itemId: "B", outfitCount: 4, lastWornOn: null },
    { itemId: "C", outfitCount: 3, lastWornOn: null },
    { itemId: "D", outfitCount: 2, lastWornOn: null },
  ];
  const lines = layoutRadialLines(partners, { max: 3, innerRadius: 50, outerRadius: 100 });
  assert.equal(lines.length, 3);
  assert.deepEqual(
    lines.map((l) => l.itemId),
    ["A", "B", "C"],
  );
  assert.ok(Math.abs(lines[0].x) < 1e-9);
  assert.equal(lines[0].y, -50);
});

test("layoutRadialLines：最少回数の相手は outerRadius、線の太さは 1〜6", () => {
  const partners = [
    { itemId: "A", outfitCount: 10, lastWornOn: null },
    { itemId: "B", outfitCount: 1, lastWornOn: null },
  ];
  const [a, b] = layoutRadialLines(partners, { max: 8, innerRadius: 50, outerRadius: 100 });
  // 2件なので B は真下（+90°）に並ぶ
  assert.ok(Math.abs(b.x) < 1e-9);
  assert.equal(b.y, 100);
  assert.equal(a.strokeWidth, 6);
  assert.equal(b.strokeWidth, 1);
  assert.equal(a.nodeRadius, 24);
  assert.equal(b.nodeRadius, 12);
  // 全員同じ回数なら innerRadius・最大のサイズ
  const [c] = layoutRadialLines([{ itemId: "C", outfitCount: 2, lastWornOn: null }], {
    max: 8,
    innerRadius: 50,
    outerRadius: 100,
  });
  assert.equal(c.y, -50);
  assert.equal(c.strokeWidth, 6);
  assert.equal(c.nodeRadius, 24);
});

test("jstTodayIsoDate：UTC 2026-10-24T15:30Z（日本時間 10/25 0:30）は '2026-10-25'", () => {
  assert.equal(jstTodayIsoDate(new Date("2026-10-24T15:30:00Z")), "2026-10-25");
  assert.equal(jstTodayIsoDate(new Date("2026-10-24T14:59:00Z")), "2026-10-24");
});
