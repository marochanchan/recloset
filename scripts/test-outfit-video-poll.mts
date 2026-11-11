// 動画の変換待ちの自動読み直しの回数・止める判断の自動テスト。
//   node --test scripts/test-outfit-video-poll.mts

import assert from "node:assert/strict";
import { test } from "node:test";

const { VIDEO_POLL_INTERVAL_MS, VIDEO_POLL_MAX_ATTEMPTS, nextVideoPoll } = await import(
  "../lib/outfits/video-poll.ts"
);

test("5秒おき・最長36回（3分）", () => {
  assert.equal(VIDEO_POLL_INTERVAL_MS, 5000);
  assert.equal(VIDEO_POLL_MAX_ATTEMPTS, 36);
  assert.equal(VIDEO_POLL_INTERVAL_MS * VIDEO_POLL_MAX_ATTEMPTS, 180_000);
});

test("最初の1回は読み直し、まだ打ち止めではない", () => {
  assert.deepEqual(nextVideoPoll(0), { refresh: true, attempts: 1, exhausted: false });
});

test("35回目までは続き、36回目で読み直してから打ち止め", () => {
  assert.deepEqual(nextVideoPoll(34), { refresh: true, attempts: 35, exhausted: false });
  assert.deepEqual(nextVideoPoll(35), { refresh: true, attempts: 36, exhausted: true });
});

test("36回を超えたら読み直さない", () => {
  assert.deepEqual(nextVideoPoll(36), { refresh: false, attempts: 36, exhausted: true });
  assert.equal(nextVideoPoll(100).refresh, false);
});

test("不正な回数（負・小数）は読み直さない", () => {
  assert.equal(nextVideoPoll(-1).refresh, false);
  assert.equal(nextVideoPoll(1.5).refresh, false);
});

test("0回から回すと、ちょうど36回読み直して止まる", () => {
  let attempts = 0;
  let refreshes = 0;
  for (let i = 0; i < 100; i++) {
    const step = nextVideoPoll(attempts);
    attempts = step.attempts;
    if (step.refresh) refreshes++;
    if (step.exhausted) break;
  }
  assert.equal(refreshes, 36);
});
