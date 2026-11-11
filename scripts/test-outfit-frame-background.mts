// 背景（そのまま／ぼかす／白）の純粋な部分の自動テスト。
//   node --test scripts/test-outfit-frame-background.mts

import assert from "node:assert/strict";
import { test } from "node:test";

const {
  BACKGROUND_MODES,
  isBackgroundMode,
  personAlphaFromCategories,
  personAlphaFromBackgroundConfidence,
  reconcileProcessed,
  resolveSendImage,
} = await import("../lib/outfits/frame-background.ts");

test("背景の設定は none / blur / white の3つだけ", () => {
  assert.deepEqual([...BACKGROUND_MODES], ["none", "blur", "white"]);
  assert.equal(isBackgroundMode("blur"), true);
  assert.equal(isBackgroundMode("black"), false);
  assert.equal(isBackgroundMode(undefined), false);
});

test("カテゴリ：背景（0）以外はすべて人（255）", () => {
  const alpha = personAlphaFromCategories([0, 1, 2, 3, 4, 5, 0]);
  assert.deepEqual([...alpha], [0, 255, 255, 255, 255, 255, 0]);
});

test("カテゴリ：背景のクラス番号を変えられる", () => {
  assert.deepEqual([...personAlphaFromCategories([0, 1, 2], 2)], [255, 255, 0]);
  assert.equal(personAlphaFromCategories([]).length, 0);
});

test("信頼度：背景がはっきりなら 0、人がはっきりなら 255、中間はなめらか", () => {
  const alpha = personAlphaFromBackgroundConfidence([1, 0.9, 0.5, 0.1, 0]);
  assert.equal(alpha[0], 0);
  assert.equal(alpha[1], 0); // 人らしさ 0.1 は下の端（0.25）より下
  assert.equal(alpha[2], 128); // ちょうど真ん中
  assert.equal(alpha[3], 255); // 人らしさ 0.9 は上の端（0.75）より上
  assert.equal(alpha[4], 255);
});

test("信頼度：人らしさが増えるほどアルファも増える（逆転しない）", () => {
  const input = Array.from({ length: 21 }, (_, i) => 1 - i / 20);
  const alpha = personAlphaFromBackgroundConfidence(input);
  for (let i = 1; i < alpha.length; i++) assert.ok(alpha[i] >= alpha[i - 1]);
});

test("信頼度：範囲外の値でも 0〜255 に収まる", () => {
  const alpha = personAlphaFromBackgroundConfidence([-3, 5]);
  assert.deepEqual([...alpha], [255, 0]);
});

test("reconcile：そのままなら処理済みを全部捨て、作るものもない", () => {
  const r = reconcileProcessed({ a: { mode: "blur", image: "A" } }, ["a", "b"], "none");
  assert.deepEqual(r, { keep: {}, pending: [] });
});

test("reconcile：設定を変えたら、前の設定の画像は捨てて作り直す", () => {
  const r = reconcileProcessed({ a: { mode: "blur", image: "A" } }, ["a"], "white");
  assert.deepEqual(r.keep, {});
  assert.deepEqual(r.pending, ["a"]);
});

test("reconcile：コマを足したら足した分だけ作り、残ったものは使い回す", () => {
  const r = reconcileProcessed({ a: { mode: "blur", image: "A" } }, ["a", "b"], "blur");
  assert.deepEqual(r.keep, { a: { mode: "blur", image: "A" } });
  assert.deepEqual(r.pending, ["b"]);
});

test("reconcile：コマを消したら、その処理済みも捨てる", () => {
  const r = reconcileProcessed(
    { a: { mode: "white", image: "A" }, b: { mode: "white", image: "B" } },
    ["b"],
    "white",
  );
  assert.deepEqual(r.keep, { b: { mode: "white", image: "B" } });
  assert.deepEqual(r.pending, []);
});

test("reconcile：入力の処理済みを書き換えない", () => {
  const processed = { a: { mode: "blur" as const, image: "A" } };
  reconcileProcessed(processed, [], "blur");
  assert.deepEqual(processed, { a: { mode: "blur", image: "A" } });
});

test("送る写真：そのままなら元の画像", () => {
  assert.equal(resolveSendImage("a", "ORIG", {}, "none"), "ORIG");
});

test("送る写真：ぼかす／白は処理済みだけ。まだなら null（元の写真は送らない）", () => {
  const processed = { a: { mode: "blur" as const, image: "PROC" } };
  assert.equal(resolveSendImage("a", "ORIG", processed, "blur"), "PROC");
  assert.equal(resolveSendImage("a", "ORIG", processed, "white"), null);
  assert.equal(resolveSendImage("b", "ORIG", processed, "blur"), null);
});
