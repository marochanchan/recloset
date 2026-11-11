// コマを選んでよい条件（lib/camera/can-pick-frame.ts）のテスト。
import assert from "node:assert/strict";
import { test } from "node:test";

const { canPickFrame } = await import("../lib/camera/can-pick-frame.ts");

test("metadata only: cannot pick", () => {
  assert.equal(canPickFrame({ readyState: 1, seeking: false, hasSeekedOnce: true }), false);
});
test("seeking: cannot pick", () => {
  assert.equal(canPickFrame({ readyState: 4, seeking: true, hasSeekedOnce: true }), false);
});
test("initial seek not done: cannot pick", () => {
  assert.equal(canPickFrame({ readyState: 4, seeking: false, hasSeekedOnce: false }), false);
});
test("current data and seek done: can pick", () => {
  assert.equal(canPickFrame({ readyState: 2, seeking: false, hasSeekedOnce: true }), true);
  assert.equal(canPickFrame({ readyState: 4, seeking: false, hasSeekedOnce: true }), true);
});
