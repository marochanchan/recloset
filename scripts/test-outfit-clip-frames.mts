// 選んだコマの列と、確定のときの送る計画の自動テスト。
//   node --test scripts/test-outfit-clip-frames.mts

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

const { MAX_PICKED_FRAMES, addPickedFrame, removePickedFrame } = await import(
  "../lib/outfits/clip-frames.ts"
);
const { planMediaUploads } = await import("../lib/outfits/upload-plan.ts");

const frame = (id: string, timeSec: number) => ({ id, timeSec, image: id });

test("addPickedFrame: 追加順に並び、同じ時刻（0.05秒以内）は足さない", () => {
  let list: ReturnType<typeof frame>[] = [];
  let r = addPickedFrame(list, frame("a", 2));
  assert.equal(r.result, "added");
  list = r.list;
  r = addPickedFrame(list, frame("b", 1));
  list = r.list;
  assert.deepEqual(list.map((f) => f.id), ["a", "b"]);
  r = addPickedFrame(list, frame("c", 2.05));
  assert.equal(r.result, "duplicate");
  assert.equal(r.list.length, 2);
  r = addPickedFrame(list, frame("d", 2.06));
  assert.equal(r.result, "added");
  assert.equal(r.list.length, 3);
});

test("addPickedFrame: 最大6枚で、7枚目は断る。元の配列は変えない", () => {
  let list: ReturnType<typeof frame>[] = [];
  for (let i = 0; i < MAX_PICKED_FRAMES; i++) list = addPickedFrame(list, frame(`f${i}`, i)).list;
  assert.equal(MAX_PICKED_FRAMES, 6);
  assert.equal(list.length, 6);
  const before = list;
  const r = addPickedFrame(list, frame("x", 99));
  assert.equal(r.result, "full");
  assert.equal(r.list, before);
});

test("removePickedFrame: id で外し、残りの順序は保つ。知らない id は何もしない", () => {
  const list = [frame("a", 1), frame("b", 2), frame("c", 3)];
  assert.deepEqual(removePickedFrame(list, "b").map((f) => f.id), ["a", "c"]);
  assert.equal(removePickedFrame(list, "zzz").length, 3);
  assert.equal(list.length, 3);
});

test("planMediaUploads: 写真0枚なら何も作らない（動画だけでも）", () => {
  assert.deepEqual(planMediaUploads({ photoCount: 0, keepVideo: true }), []);
  assert.deepEqual(planMediaUploads({ photoCount: 0, keepVideo: false }), []);
});

test("planMediaUploads: 最初の写真が下書きを作り、残りの写真、動画の順。sortOrder は 0.. の連番", () => {
  assert.deepEqual(planMediaUploads({ photoCount: 3, keepVideo: true }), [
    { kind: "photo", photoIndex: 0, sortOrder: 0, createsDraft: true },
    { kind: "photo", photoIndex: 1, sortOrder: 1, createsDraft: false },
    { kind: "photo", photoIndex: 2, sortOrder: 2, createsDraft: false },
    { kind: "video", photoIndex: null, sortOrder: 3, createsDraft: false },
  ]);
  assert.deepEqual(planMediaUploads({ photoCount: 1, keepVideo: false }), [
    { kind: "photo", photoIndex: 0, sortOrder: 0, createsDraft: true },
  ]);
});

test("planMediaUploads: 写真が6枚を超える・負・小数は例外", () => {
  assert.throws(() => planMediaUploads({ photoCount: 7, keepVideo: false }));
  assert.throws(() => planMediaUploads({ photoCount: -1, keepVideo: false }));
  assert.throws(() => planMediaUploads({ photoCount: 1.5, keepVideo: false }));
});

// ---- addOutfitMediaUpload の入力チェックと、本人の下書きだけに足す確認 ----
const { OutfitNotDraftError, addMediaToDraft, isValidCompleteSize, parseAddMediaInput } = await import(
  "../lib/outfits/add-media.ts"
);
const { createFakeMediaStore } = await import("../lib/media/fake-media-store.ts");

const OUTFIT_ID = "00000000-0000-4000-8000-0000000000a1";
const MEDIA_ID = "00000000-0000-4000-8000-0000000000b1";
const USER_ID = "00000000-0000-4000-8000-000000000001";
import type { OutfitMediaDb, OutfitMediaRow } from "../lib/outfits/media-db.ts";

const good = { outfitId: OUTFIT_ID, mediaId: MEDIA_ID, kind: "photo", sortOrder: 1 };

test("parseAddMediaInput: 正しい入力を通す", () => {
  assert.deepEqual(parseAddMediaInput(good), { ok: true, value: good });
  assert.deepEqual(parseAddMediaInput({ ...good, kind: "video", sortOrder: 6 }).ok, true);
});

test("parseAddMediaInput: UUID・kind・sortOrder の範囲（1〜6、整数）を確かめる", () => {
  for (const bad of [
    null,
    "x",
    { ...good, outfitId: "nope" },
    { ...good, mediaId: 5 },
    { ...good, kind: "frame" },
    { ...good, kind: undefined },
    { ...good, sortOrder: 0 }, // 0 番は下書きを作る写真（startOutfitPhotoUpload）だけ
    { ...good, sortOrder: 7 },
    { ...good, sortOrder: 1.5 },
    { ...good, sortOrder: "1" },
  ]) {
    assert.equal(parseAddMediaInput(bad).ok, false, JSON.stringify(bad));
  }
});

function fakeDb() {
  const rows = new Map<string, OutfitMediaRow & { sortOrder: number }>();
  const db: OutfitMediaDb = {
    async getMedia(_userId, id) {
      return rows.get(id) ?? null;
    },
    async registerMedia(i) {
      const row = {
        id: i.mediaId, outfitId: i.outfitId, userId: i.userId, kind: i.kind, provider: i.provider,
        providerAssetId: i.assetId, uploadAttempt: 1, uploadExpiresAt: null, status: "uploading" as const,
        width: null, height: null, durationSec: null, sortOrder: i.sortOrder,
      };
      rows.set(i.mediaId, row);
      return row;
    },
    async setState(i) {
      const row = rows.get(i.mediaId);
      if (!row) throw new Error("no row");
      row.status = i.status;
      return { ...row };
    },
    async replaceAsset() {
      throw new Error("unused");
    },
  };
  return { rows, db };
}

test("addMediaToDraft: 本人の下書きにだけ足す。違えば Cloudflare にも DB にも触らない", async () => {
  const { db, rows } = fakeDb();
  const store = createFakeMediaStore();
  const deps = { db, store, now: () => new Date("2026-11-11T00:00:00Z") };
  await assert.rejects(
    addMediaToDraft(deps, { userId: USER_ID, ...good, kind: "photo", isOwnDraft: async () => false }),
    OutfitNotDraftError,
  );
  assert.equal(rows.size, 0);
  assert.equal(store.assets.size, 0);
});

test("addMediaToDraft: 写真と動画の upload URL を返し、同じ mediaId の2回目は壊れず新しい行を作らない", async () => {
  const { db, rows } = fakeDb();
  const store = createFakeMediaStore();
  const deps = { db, store, now: () => new Date("2026-11-11T00:00:00Z") };
  const seen: string[] = [];
  const isOwnDraft = async (id: string) => (seen.push(id), true);

  const video = await addMediaToDraft(deps, {
    userId: USER_ID, outfitId: OUTFIT_ID, mediaId: MEDIA_ID, kind: "video", sortOrder: 2, isOwnDraft,
  });
  assert.equal(video.mediaId, MEDIA_ID);
  assert.ok(video.uploadUrl);
  assert.equal(rows.get(MEDIA_ID)?.kind, "video");
  assert.equal(rows.get(MEDIA_ID)?.sortOrder, 2);
  assert.deepEqual(seen, [OUTFIT_ID, OUTFIT_ID]); // 登録の前と後

  // 2回目：届いていれば uploadUrl は null（retry に回る）
  const assetId = rows.get(MEDIA_ID)?.providerAssetId as string;
  store.setState(assetId, { state: "ready" });
  const again = await addMediaToDraft(deps, {
    userId: USER_ID, outfitId: OUTFIT_ID, mediaId: MEDIA_ID, kind: "video", sortOrder: 2, isOwnDraft,
  });
  assert.equal(again.uploadUrl, null);
  assert.equal(rows.size, 1);
});

test("addMediaToDraft: 登録のあいだに確定されたら、エラーで URL は返さず、実体の削除も行の変更もしない", async () => {
  const { db, rows } = fakeDb();
  const store = createFakeMediaStore();
  let deletes = 0;
  const originalDelete = store.deleteAsset.bind(store);
  store.deleteAsset = async (p, a) => (deletes++, originalDelete(p, a));
  const deps = { db, store, now: () => new Date("2026-11-11T00:00:00Z") };
  let calls = 0;
  const isOwnDraft = async () => ++calls === 1; // 1回目は下書き、2回目（登録のあと）は確定済み
  await assert.rejects(
    addMediaToDraft(deps, { userId: USER_ID, ...good, kind: "photo", isOwnDraft }),
    OutfitNotDraftError,
  );
  assert.equal(calls, 2);
  assert.equal(deletes, 0);
  assert.equal(store.assets.size, 1);
  assert.equal(rows.get(MEDIA_ID)?.status, "uploading");
});

test("isValidCompleteSize: 寸法の省略は動画だけ。写真は必須、片方だけ・範囲外・小数は不可", () => {
  assert.equal(isValidCompleteSize("video", undefined, undefined), true);
  assert.equal(isValidCompleteSize("photo", undefined, undefined), false);
  assert.equal(isValidCompleteSize("photo", 800, 1200), true);
  assert.equal(isValidCompleteSize("video", 800, 1200), true);
  assert.equal(isValidCompleteSize("video", 800, undefined), false);
  assert.equal(isValidCompleteSize("photo", 0, 10), false);
  assert.equal(isValidCompleteSize("photo", 20001, 10), false);
  assert.equal(isValidCompleteSize("photo", 1.5, 10), false);
});

const { recordingNeedsRotation, rotatedSize, ROTATION_AFTER_RECORDING } = await import(
  "../lib/camera/clip-rotation.ts"
);

test("clip-rotation: 90/270 で幅と高さが入れ替わる。0 は録画で回さない。録ったあとの向きは常に 0", () => {
  assert.deepEqual(rotatedSize({ width: 1920, height: 1080 }, 90), { width: 1080, height: 1920 });
  assert.deepEqual(rotatedSize({ width: 1920, height: 1080 }, 270), { width: 1080, height: 1920 });
  assert.deepEqual(rotatedSize({ width: 1920, height: 1080 }, 180), { width: 1920, height: 1080 });
  assert.deepEqual(rotatedSize({ width: 1920, height: 1080 }, 0), { width: 1920, height: 1080 });
  assert.equal(recordingNeedsRotation(0), false);
  assert.equal(recordingNeedsRotation(90), true);
  assert.equal(ROTATION_AFTER_RECORDING, 0);
});

const { createGeneration } = await import("../lib/outfits/async-generation.ts");
const { displayVideoFromRow } = await import("../lib/outfits/video-display.ts");

test("createGeneration: bump のあと、古い世代は使えず、新しい世代だけ使える", () => {
  const gen = createGeneration();
  const first = gen.current();
  assert.equal(gen.isCurrent(first), true);
  gen.bump(); // 隠れた・撮り直した
  assert.equal(gen.isCurrent(first), false);
  assert.equal(gen.isCurrent(gen.current()), true);
});

test("displayVideoFromRow: 置き換わった試行の asset ID・状態・寸法をそろえて行から作る", () => {
  const refreshed = {
    id: "m", outfitId: "o", userId: "u", kind: "video" as const, provider: "cf_stream" as const,
    providerAssetId: "new-asset", uploadAttempt: 2, uploadExpiresAt: null, status: "ready" as const,
    width: 720, height: 1280, durationSec: 5,
  };
  assert.deepEqual(displayVideoFromRow(refreshed), {
    status: "ready", provider_asset_id: "new-asset", width: 720, height: 1280,
  });
});
