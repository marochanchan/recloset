// 端末から選んだ動画の受け入れ判定・言葉・ファイル名の自動テスト。
//   node --test scripts/test-outfit-library-video.mts

import assert from "node:assert/strict";
import { test } from "node:test";

const {
  LIBRARY_VIDEO_MAX_BYTES,
  LIBRARY_VIDEO_MAX_SECONDS,
  LIBRARY_VIDEO_MESSAGES,
  judgeLibraryVideo,
  libraryVideoUploadName,
} = await import("../lib/outfits/library-video.ts");

test("上限は Stream の60秒と、基本の POST の200MB", () => {
  assert.equal(LIBRARY_VIDEO_MAX_SECONDS, 60);
  assert.equal(LIBRARY_VIDEO_MAX_BYTES, 200_000_000);
});

test("judgeLibraryVideo: 60秒ちょうど・上限ちょうどの大きさは通る", () => {
  assert.deepEqual(judgeLibraryVideo({ sizeBytes: 1000, durationSec: 5 }), { ok: true });
  assert.deepEqual(judgeLibraryVideo({ sizeBytes: 200_000_000, durationSec: 60 }), { ok: true });
});

test("judgeLibraryVideo: 60秒を超えたら too_long", () => {
  assert.deepEqual(judgeLibraryVideo({ sizeBytes: 1000, durationSec: 60.1 }), { ok: false, reason: "too_long" });
});

test("judgeLibraryVideo: 200MB を超えたら too_large（長さが長くても大きさを先に言う）", () => {
  assert.deepEqual(judgeLibraryVideo({ sizeBytes: 200_000_001, durationSec: 5 }), { ok: false, reason: "too_large" });
  assert.deepEqual(judgeLibraryVideo({ sizeBytes: 300_000_000, durationSec: 90 }), { ok: false, reason: "too_large" });
});

test("judgeLibraryVideo: 長さが分からない（Infinity・NaN・0・負）は unreadable", () => {
  for (const durationSec of [Infinity, NaN, 0, -1]) {
    assert.deepEqual(judgeLibraryVideo({ sizeBytes: 1000, durationSec }), { ok: false, reason: "unreadable" });
  }
});

test("言葉：3つの理由それぞれに、責めない一言がある", () => {
  assert.equal(LIBRARY_VIDEO_MESSAGES.too_long, "60秒までの動画を選んでください");
  assert.equal(LIBRARY_VIDEO_MESSAGES.too_large, "200MB までの動画を選んでください");
  assert.equal(LIBRARY_VIDEO_MESSAGES.unreadable, "この動画は開けませんでした。別の動画を選んでください");
});

test("libraryVideoUploadName: 種類（なければ拡張子）からファイル名を決める", () => {
  assert.equal(libraryVideoUploadName({ type: "video/quicktime", name: "IMG_1.MOV" }), "outfit.mov");
  assert.equal(libraryVideoUploadName({ type: "", name: "IMG_1.MOV" }), "outfit.mov");
  assert.equal(libraryVideoUploadName({ type: "video/mp4" }), "outfit.mp4");
  assert.equal(libraryVideoUploadName({ type: "", name: "a.m4v" }), "outfit.mp4");
  assert.equal(libraryVideoUploadName({ type: "video/webm" }), "outfit.webm");
  assert.equal(libraryVideoUploadName({ type: "", name: "noext" }), "outfit.mp4");
});
