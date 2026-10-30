// アップロードの処理（lib/outfits/media-service.ts）の自動テスト。
// DB はメモリ上のダミー（Task 7 の RPC と同じ振る舞い）、置き場は createFakeMediaStore。
// ネットワークにも本物の DB にも接続しない。
//
// 実行方法:
//   node --test scripts/test-outfit-media-service.mts

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

const {
  MediaNotFoundError,
  MediaNotUploadedError,
  MediaStateTransitionError,
  MediaUploadConflictError,
  completeMediaUpload,
  retryMediaUpload,
  startMediaUpload,
} = await import("../lib/outfits/media-service.ts");
const { createFakeMediaStore } = await import("../lib/media/fake-media-store.ts");

import type { OutfitMediaDb, OutfitMediaRow } from "../lib/outfits/media-db.ts";

const USER = "00000000-0000-4000-8000-000000000001";
const OUTFIT = "00000000-0000-4000-8000-0000000000a1";
const OTHER_OUTFIT = "00000000-0000-4000-8000-0000000000a2";
const MEDIA = "00000000-0000-4000-8000-0000000000b1";
const NOW = new Date("2026-10-25T03:00:00.000Z");

// Task 7 の RPC と同じ規則のメモリ上のダミー
function createFakeDb() {
  const rows = new Map<string, OutfitMediaRow>();
  const deletionQueue: string[] = [];
  const hooks = {
    failNextRegister: null as Error | null,
    saveThenThrowNext: null as Error | null,
    nullNextGetMedia: false,
  };

  const db: OutfitMediaDb = {
    async registerMedia(i) {
      if (hooks.failNextRegister) {
        const e = hooks.failNextRegister;
        hooks.failNextRegister = null;
        throw e;
      }
      const existing = rows.get(i.mediaId);
      if (existing) {
        if (
          existing.userId !== i.userId ||
          existing.outfitId !== i.outfitId ||
          existing.kind !== i.kind ||
          existing.provider !== i.provider
        ) {
          throw new MediaUploadConflictError("media_conflict");
        }
        return { ...existing };
      }
      const row: OutfitMediaRow = {
        id: i.mediaId,
        outfitId: i.outfitId,
        userId: i.userId,
        kind: i.kind,
        provider: i.provider,
        providerAssetId: i.assetId,
        uploadAttempt: 1,
        uploadExpiresAt: i.uploadExpiresAt.toISOString(),
        status: "uploading",
        width: null,
        height: null,
        durationSec: null,
      };
      rows.set(i.mediaId, row);
      if (hooks.saveThenThrowNext) {
        const e = hooks.saveThenThrowNext;
        hooks.saveThenThrowNext = null;
        throw e;
      }
      return { ...row };
    },
    async getMedia(userId, mediaId) {
      if (hooks.nullNextGetMedia) {
        hooks.nullNextGetMedia = false;
        return null;
      }
      const row = rows.get(mediaId);
      return row && row.userId === userId ? { ...row } : null;
    },
    async replaceAsset(i) {
      const row = rows.get(i.mediaId);
      if (!row || row.userId !== i.userId) throw new MediaNotFoundError("media_not_found");
      if (row.uploadAttempt !== i.expectedUploadAttempt) {
        throw new MediaUploadConflictError("media_attempt_changed");
      }
      if (row.status === "processing" || row.status === "ready") return { ...row };
      deletionQueue.push(row.providerAssetId);
      row.providerAssetId = i.assetId;
      row.uploadAttempt += 1;
      row.uploadExpiresAt = i.uploadExpiresAt.toISOString();
      row.status = "uploading";
      // 023 と同じく、前の試行の大きさは消す
      row.width = null;
      row.height = null;
      row.durationSec = null;
      return { ...row };
    },
    async setState(i) {
      const row = rows.get(i.mediaId);
      if (!row || row.userId !== i.userId) throw new MediaNotFoundError("media_not_found");
      if (row.uploadAttempt !== i.expectedUploadAttempt) {
        throw new MediaUploadConflictError("media_attempt_changed");
      }
      const ok =
        (row.status === "uploading" && ["processing", "ready", "failed"].includes(i.status)) ||
        (row.status === "processing" && ["processing", "ready", "failed"].includes(i.status)) ||
        (row.status === "ready" && i.status === "ready");
      if (!ok) throw new MediaStateTransitionError("invalid_media_transition");
      row.status = i.status;
      if (i.width !== undefined) row.width = i.width;
      if (i.height !== undefined) row.height = i.height;
      if (i.durationSec !== undefined) row.durationSec = i.durationSec;
      return { ...row };
    },
  };
  return { db, rows, deletionQueue, hooks };
}

function setup() {
  const store = createFakeMediaStore();
  const fake = createFakeDb();
  const createCalls: { kind: string; userId: string; mediaId: string; expiresAt: Date }[] = [];
  const originalCreate = store.createUpload.bind(store);
  store.createUpload = async (input) => {
    createCalls.push(input);
    return originalCreate(input);
  };
  const deps = { db: fake.db, store, now: () => NOW };
  const startInput = {
    userId: USER,
    mediaId: MEDIA,
    outfitId: OUTFIT,
    kind: "photo" as const,
    takenAt: null,
    sortOrder: 0,
  };
  return { store, ...fake, deps, createCalls, startInput };
}

test("開始：渡されたメディア ID を、Cloudflare のメタデータと DB の両方に使う", async () => {
  const s = setup();
  const result = await startMediaUpload(s.deps, s.startInput);
  assert.equal(result.mediaId, MEDIA);
  assert.ok(result.uploadUrl?.startsWith("https://fake-upload.example/"));
  assert.equal(s.createCalls.length, 1);
  assert.equal(s.createCalls[0].mediaId, MEDIA);
  assert.equal(s.createCalls[0].userId, USER);
  const row = s.rows.get(MEDIA);
  assert.ok(row);
  assert.equal(row.id, MEDIA);
  assert.equal(row.providerAssetId, "fake-photo-1");
  assert.equal(row.status, "uploading");
});

test("開始：同じメディア ID で2回呼ぶと、メディアは1つのままで、Cloudflare に届いていれば uploadUrl は null", async () => {
  const s = setup();
  await startMediaUpload(s.deps, s.startInput);
  s.store.setState("fake-photo-1", { state: "ready" });
  const second = await startMediaUpload(s.deps, s.startInput);
  assert.equal(second.uploadUrl, null);
  assert.equal(s.rows.size, 1);
  assert.equal(s.createCalls.length, 1);
  const row = s.rows.get(MEDIA);
  assert.equal(row?.status, "ready");
  assert.equal(row?.uploadAttempt, 1);
});

test("開始：DB への保存が失敗したら、作った Cloudflare の ID を deleteAsset してから元のエラーを投げる", async () => {
  const s = setup();
  const boom = new Error("db down");
  s.hooks.failNextRegister = boom;
  await assert.rejects(startMediaUpload(s.deps, s.startInput), (e) => e === boom);
  assert.equal(s.store.assets.size, 0);
  assert.equal(s.rows.size, 0);
});

test("開始：DB には保存できて応答だけ失われた場合（ダミーが行を保存してから例外）、次の送り直しで新しい試行になり、upload_attempt は 2", async () => {
  const s = setup();
  s.hooks.saveThenThrowNext = new Error("response lost");
  await assert.rejects(startMediaUpload(s.deps, s.startInput), /response lost/);
  assert.equal(s.rows.get(MEDIA)?.uploadAttempt, 1);
  // 消した ID は Cloudflare にもう無い
  assert.equal(s.store.assets.size, 0);
  const again = await startMediaUpload(s.deps, s.startInput);
  assert.ok(again.uploadUrl);
  const row = s.rows.get(MEDIA);
  assert.equal(row?.uploadAttempt, 2);
  assert.equal(row?.providerAssetId, "fake-photo-2");
  assert.equal(s.rows.size, 1);
});

test("開始：registerMedia が別の asset ID の行を返したら（同時の開始）、自分の ID を消して MediaUploadConflictError", async () => {
  const s = setup();
  // もう一方の開始が先に登録済み（その ID は別の Cloudflare 資産）
  await s.db.registerMedia({
    userId: USER,
    mediaId: MEDIA,
    outfitId: OUTFIT,
    kind: "photo",
    provider: "cf_images",
    assetId: "other-asset",
    uploadExpiresAt: new Date(NOW.getTime() + 1000),
    takenAt: null,
    sortOrder: 0,
  });
  s.store.assets.set("other-asset", { provider: "cf_images", state: "awaiting_upload" });
  s.hooks.nullNextGetMedia = true; // 自分が見たときはまだ無かった
  await assert.rejects(startMediaUpload(s.deps, s.startInput), (e) => e instanceof MediaUploadConflictError);
  // 消えたのは自分の ID だけで、先に登録した方の ID は残る
  assert.deepEqual([...s.store.assets.keys()], ["other-asset"]);
  assert.equal(s.rows.get(MEDIA)?.providerAssetId, "other-asset");
});

test("開始：同じ本人の別のコーデのメディア ID なら MediaUploadConflictError で、Cloudflare は呼ばない", async () => {
  const s = setup();
  await startMediaUpload(s.deps, s.startInput);
  await assert.rejects(
    startMediaUpload(s.deps, { ...s.startInput, outfitId: OTHER_OUTFIT }),
    (e) => e instanceof MediaUploadConflictError,
  );
  assert.equal(s.createCalls.length, 1);
  await assert.rejects(
    startMediaUpload(s.deps, { ...s.startInput, kind: "video" }),
    (e) => e instanceof MediaUploadConflictError,
  );
  assert.equal(s.createCalls.length, 1);
});

test("開始：アップロード URL の期限は now の30分後", async () => {
  const s = setup();
  await startMediaUpload(s.deps, s.startInput);
  const expected = new Date(NOW.getTime() + 30 * 60 * 1000);
  assert.equal(s.createCalls[0].expiresAt.getTime(), expected.getTime());
  assert.equal(s.rows.get(MEDIA)?.uploadExpiresAt, expected.toISOString());
});

test("完了：写真の実体が awaiting_upload なら MediaNotUploadedError で、状態は uploading のまま", async () => {
  const s = setup();
  await startMediaUpload(s.deps, s.startInput);
  await assert.rejects(
    completeMediaUpload(s.deps, { userId: USER, mediaId: MEDIA }),
    (e) => e instanceof MediaNotUploadedError,
  );
  assert.equal(s.rows.get(MEDIA)?.status, "uploading");
});

test("完了：写真の実体が ready なら ready になり、width・height が入る", async () => {
  const s = setup();
  await startMediaUpload(s.deps, s.startInput);
  s.store.setState("fake-photo-1", { state: "ready" });
  const row = await completeMediaUpload(s.deps, { userId: USER, mediaId: MEDIA, width: 2560, height: 1440 });
  assert.equal(row.status, "ready");
  assert.equal(row.width, 2560);
  assert.equal(row.height, 1440);
});

test("完了：動画の実体が processing なら processing。もう一度知らせても processing のまま（エラーにならない）", async () => {
  const s = setup();
  await startMediaUpload(s.deps, { ...s.startInput, kind: "video" });
  s.store.setState("fake-video-1", { state: "processing" });
  const first = await completeMediaUpload(s.deps, { userId: USER, mediaId: MEDIA });
  assert.equal(first.status, "processing");
  const second = await completeMediaUpload(s.deps, { userId: USER, mediaId: MEDIA });
  assert.equal(second.status, "processing");
});

test("完了：実体を確かめているあいだに、別の処理が試行を置き換えたら MediaUploadConflictError で、新しい試行は uploading のまま", async () => {
  const s = setup();
  await startMediaUpload(s.deps, s.startInput);
  s.store.setState("fake-photo-1", { state: "ready" });
  const original = s.store.getAssetState.bind(s.store);
  s.store.getAssetState = async (provider, assetId) => {
    // 確かめる途中で、別の送り直しが試行を置き換える
    await s.db.replaceAsset({
      userId: USER,
      mediaId: MEDIA,
      expectedUploadAttempt: 1,
      assetId: "replacement",
      uploadExpiresAt: NOW,
    });
    return original(provider, assetId);
  };
  await assert.rejects(
    completeMediaUpload(s.deps, { userId: USER, mediaId: MEDIA }),
    (e) => e instanceof MediaUploadConflictError,
  );
  const row = s.rows.get(MEDIA);
  assert.equal(row?.status, "uploading");
  assert.equal(row?.uploadAttempt, 2);
});

test("送り直し：Cloudflare に届いていれば新しい試行を作らず、uploadUrl は null で ready になる", async () => {
  const s = setup();
  await startMediaUpload(s.deps, s.startInput);
  s.store.setState("fake-photo-1", { state: "ready" });
  const result = await retryMediaUpload(s.deps, { userId: USER, mediaId: MEDIA });
  assert.equal(result.uploadUrl, null);
  assert.equal(result.row.status, "ready");
  assert.equal(result.row.uploadAttempt, 1);
  assert.equal(s.createCalls.length, 1);
  assert.deepEqual(s.deletionQueue, []);
});

test("送り直し：期限切れ（missing）なら新しい asset を作り、replaceAsset で upload_attempt が増える", async () => {
  const s = setup();
  await startMediaUpload(s.deps, s.startInput);
  s.store.assets.delete("fake-photo-1");
  const result = await retryMediaUpload(s.deps, { userId: USER, mediaId: MEDIA });
  assert.ok(result.uploadUrl);
  assert.equal(result.row.uploadAttempt, 2);
  assert.equal(result.row.providerAssetId, "fake-photo-2");
  assert.equal(result.row.status, "uploading");
  assert.deepEqual(s.deletionQueue, ["fake-photo-1"]);
});

test("送り直し：2つの送り直しが同じ試行を見て、あとの方の replaceAsset が食い違ったら、あとの方が作った ID を消して MediaUploadConflictError。先の方の URL の ID は削除待ちに入らない", async () => {
  const s = setup();
  await startMediaUpload(s.deps, s.startInput);
  s.store.assets.delete("fake-photo-1");
  // 2つとも同じ試行を読み終えるまで待たせる
  const original = s.store.getAssetState.bind(s.store);
  let arrived = 0;
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  s.store.getAssetState = async (provider, assetId) => {
    arrived += 1;
    if (arrived >= 2) release();
    await gate;
    return original(provider, assetId);
  };
  const results = await Promise.allSettled([
    retryMediaUpload(s.deps, { userId: USER, mediaId: MEDIA }),
    retryMediaUpload(s.deps, { userId: USER, mediaId: MEDIA }),
  ]);
  const fulfilled = results.filter((r) => r.status === "fulfilled");
  const rejected = results.filter((r) => r.status === "rejected");
  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
  assert.ok(rejected[0].reason instanceof MediaUploadConflictError);
  const winnerId = s.rows.get(MEDIA)?.providerAssetId;
  assert.equal(s.rows.get(MEDIA)?.uploadAttempt, 2);
  // 負けた方の ID は消え、勝った方の ID だけが残る
  assert.deepEqual([...s.store.assets.keys()], [winnerId]);
  assert.deepEqual(s.deletionQueue, ["fake-photo-1"]);
});

test("送り直し：実体を確かめたあと、完了の知らせが同じ試行を先に ready にしたら、作った新しい ID を消して uploadUrl は null。届いた写真の ID は削除待ちに入らない", async () => {
  const s = setup();
  await startMediaUpload(s.deps, s.startInput);
  const original = s.store.getAssetState.bind(s.store);
  s.store.getAssetState = async (provider, assetId) => {
    const state = await original(provider, assetId); // awaiting_upload
    // 返す前に、完了の知らせが同じ試行を ready にする
    await s.db.setState({ userId: USER, mediaId: MEDIA, expectedUploadAttempt: 1, status: "ready" });
    return state;
  };
  const result = await retryMediaUpload(s.deps, { userId: USER, mediaId: MEDIA });
  assert.equal(result.uploadUrl, null);
  assert.equal(result.row.status, "ready");
  assert.equal(result.row.providerAssetId, "fake-photo-1");
  assert.equal(s.createCalls.length, 2);
  assert.deepEqual([...s.store.assets.keys()], ["fake-photo-1"]);
  assert.deepEqual(s.deletionQueue, []);
});

test("他人のメディア ID：getMedia が null なら MediaNotFoundError（Cloudflare は呼ばない）", async () => {
  const s = setup();
  await s.db.registerMedia({
    userId: "00000000-0000-4000-8000-0000000000ff",
    mediaId: MEDIA,
    outfitId: OUTFIT,
    kind: "photo",
    provider: "cf_images",
    assetId: "theirs",
    uploadExpiresAt: NOW,
    takenAt: null,
    sortOrder: 0,
  });
  await assert.rejects(
    completeMediaUpload(s.deps, { userId: USER, mediaId: MEDIA }),
    (e) => e instanceof MediaNotFoundError,
  );
  await assert.rejects(
    retryMediaUpload(s.deps, { userId: USER, mediaId: MEDIA }),
    (e) => e instanceof MediaNotFoundError,
  );
  assert.equal(s.createCalls.length, 0);
});

// webhook が終わりの状態を先に書いたあとに、確かめた processing を書こうとする場合
async function videoWithWebhookRace(terminal: "ready" | "failed", replace: boolean) {
  const s = setup();
  await startMediaUpload(s.deps, { ...s.startInput, kind: "video" });
  s.store.setState("fake-video-1", { state: "processing" });
  const original = s.store.getAssetState.bind(s.store);
  s.store.getAssetState = async (provider, assetId) => {
    const state = await original(provider, assetId);
    await s.db.setState({ userId: USER, mediaId: MEDIA, expectedUploadAttempt: 1, status: terminal });
    if (replace && terminal === "failed") {
      await s.db.replaceAsset({
        userId: USER,
        mediaId: MEDIA,
        expectedUploadAttempt: 1,
        assetId: "replacement",
        uploadExpiresAt: NOW,
      });
    }
    return state;
  };
  return s;
}

for (const terminal of ["ready", "failed"] as const) {
  test(`完了：確かめているあいだに webhook が ${terminal} を書いたら、その行を返す`, async () => {
    const s = await videoWithWebhookRace(terminal, false);
    const row = await completeMediaUpload(s.deps, { userId: USER, mediaId: MEDIA });
    assert.equal(row.status, terminal);
    assert.equal(row.uploadAttempt, 1);
  });

  test(`送り直し：確かめているあいだに webhook が ${terminal} を書いたら、新しい試行を作らず uploadUrl は null でその行を返す`, async () => {
    const s = await videoWithWebhookRace(terminal, false);
    const result = await retryMediaUpload(s.deps, { userId: USER, mediaId: MEDIA });
    assert.equal(result.uploadUrl, null);
    assert.equal(result.row.status, terminal);
    assert.equal(s.createCalls.length, 1);
  });
}

test("完了・送り直し：webhook の failed のあとに試行が置き換わったら MediaUploadConflictError", async () => {
  const a = await videoWithWebhookRace("failed", true);
  await assert.rejects(
    completeMediaUpload(a.deps, { userId: USER, mediaId: MEDIA }),
    (e) => e instanceof MediaUploadConflictError,
  );
  const b = await videoWithWebhookRace("failed", true);
  await assert.rejects(
    retryMediaUpload(b.deps, { userId: USER, mediaId: MEDIA }),
    (e) => e instanceof MediaUploadConflictError,
  );
});
