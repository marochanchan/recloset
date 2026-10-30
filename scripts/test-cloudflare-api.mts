// Cloudflare API のラッパーと MediaStore（lib/media/cloudflare-api.ts・
// media-store.ts・fake-media-store.ts）の自動テスト。ネットワークには接続しない。
//
// 実行方法:
//   node --test scripts/test-cloudflare-api.mts

import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
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

const { CloudflareApiError, createCloudflareApi } = await import("../lib/media/cloudflare-api.ts");
const { createCloudflareMediaStore, mapStreamState } = await import("../lib/media/media-store.ts");
const { createFakeMediaStore } = await import("../lib/media/fake-media-store.ts");

const apiConfig = { accountId: "acc1", apiToken: "secret-token" };
const base = "https://api.cloudflare.com/client/v4/accounts/acc1";

type Call = { url: string; method: string; headers: Headers; body: unknown };

// 呼び先ごとに決まった応答を返し、呼ばれた内容を記録するダミーの fetch
function fakeFetch(respond: (call: Call) => { status?: number; json?: unknown; raw?: string }) {
  const calls: Call[] = [];
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    const call: Call = {
      url: String(input),
      method: init?.method ?? "GET",
      headers: new Headers(init?.headers),
      body: init?.body,
    };
    calls.push(call);
    const { status = 200, json, raw } = respond(call);
    return new Response(raw ?? JSON.stringify(json), { status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { calls, impl };
}

const ok = (result: unknown) => ({ json: { success: true, errors: [], result } });
const notFound = () => ({ status: 404, json: { success: false, errors: [{ code: 1000, message: "not found" }], result: null } });

test("写真のアップロード URL：direct_upload に requireSignedURLs と metadata と expiry を送る", async () => {
  const { calls, impl } = fakeFetch(() => ok({ id: "img-1", uploadURL: "https://upload.example/img-1" }));
  const store = createCloudflareMediaStore(fullConfig(), createCloudflareApi(apiConfig, impl));
  const result = await store.createUpload({
    kind: "photo",
    userId: "u1",
    mediaId: "m1",
    expiresAt: new Date("2026-10-25T00:30:00.000Z"),
  });
  assert.deepEqual(result, { provider: "cf_images", assetId: "img-1", uploadUrl: "https://upload.example/img-1" });
  assert.equal(calls[0].url, `${base}/images/v2/direct_upload`);
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].headers.get("authorization"), "Bearer secret-token");
  const form = calls[0].body as FormData;
  assert.equal(form.get("requireSignedURLs"), "true");
  assert.deepEqual(JSON.parse(String(form.get("metadata"))), { userId: "u1", mediaId: "m1" });
  assert.equal(form.get("expiry"), "2026-10-25T00:30:00.000Z");
});

test("動画のアップロード URL：maxDurationSeconds 60、requireSignedURLs true、meta に userId と mediaId", async () => {
  const { calls, impl } = fakeFetch(() => ok({ uid: "vid-1", uploadURL: "https://upload.example/vid-1" }));
  const store = createCloudflareMediaStore(fullConfig(), createCloudflareApi(apiConfig, impl));
  const result = await store.createUpload({
    kind: "video",
    userId: "u1",
    mediaId: "m1",
    expiresAt: new Date("2026-10-25T00:30:00.000Z"),
  });
  assert.deepEqual(result, { provider: "cf_stream", assetId: "vid-1", uploadUrl: "https://upload.example/vid-1" });
  assert.equal(calls[0].url, `${base}/stream/direct_upload`);
  assert.equal(calls[0].method, "POST");
  assert.deepEqual(JSON.parse(String(calls[0].body)), {
    maxDurationSeconds: 60,
    requireSignedURLs: true,
    meta: { userId: "u1", mediaId: "m1" },
    expiry: "2026-10-25T00:30:00.000Z",
  });
});

test("getAssetState：Images の draft は awaiting_upload、draft なしは ready、404 は missing", async () => {
  const bodies: Record<string, ReturnType<typeof ok>> = {
    draft: ok({ id: "draft", draft: true, variants: [] }),
    done: ok({ id: "done", variants: ["https://imagedelivery.net/h/done/thumb"] }),
  };
  const { calls, impl } = fakeFetch((call) => bodies[call.url.split("/").pop()!] ?? notFound());
  const store = createCloudflareMediaStore(fullConfig(), createCloudflareApi(apiConfig, impl));
  assert.deepEqual(await store.getAssetState("cf_images", "draft"), { state: "awaiting_upload" });
  assert.deepEqual(await store.getAssetState("cf_images", "done"), { state: "ready" });
  assert.deepEqual(await store.getAssetState("cf_images", "gone"), { state: "missing" });
  assert.equal(calls[0].url, `${base}/images/v1/draft`);
  assert.equal(calls[0].method, "GET");
});

test("getAssetState：Stream の pendingupload/inprogress/ready/error/404 を対応する状態にし、ready では width・height・durationSec を返す", async () => {
  const video = (state: string, readyToStream: boolean, extra: object = {}) =>
    ok({ uid: "x", readyToStream, status: { state }, input: { width: -1, height: -1 }, duration: -1, preview: "p", ...extra });
  const bodies: Record<string, ReturnType<typeof ok>> = {
    pending: video("pendingupload", false),
    progress: video("inprogress", false),
    ready: video("ready", true, { input: { width: 1080, height: 1920 }, duration: 12.5 }),
    broken: video("error", false),
  };
  const { calls, impl } = fakeFetch((call) => bodies[call.url.split("/").pop()!] ?? notFound());
  const store = createCloudflareMediaStore(fullConfig(), createCloudflareApi(apiConfig, impl));
  assert.deepEqual(await store.getAssetState("cf_stream", "pending"), { state: "awaiting_upload" });
  assert.deepEqual(await store.getAssetState("cf_stream", "progress"), { state: "processing" });
  assert.deepEqual(await store.getAssetState("cf_stream", "ready"), {
    state: "ready",
    width: 1080,
    height: 1920,
    durationSec: 12.5,
  });
  assert.deepEqual(await store.getAssetState("cf_stream", "broken"), { state: "failed" });
  assert.deepEqual(await store.getAssetState("cf_stream", "gone"), { state: "missing" });
  assert.equal(calls[0].url, `${base}/stream/pending`);
});

test("mapStreamState：state が ready でも readyToStream が false なら processing", () => {
  assert.equal(mapStreamState({ state: "ready", readyToStream: false }), "processing");
  assert.equal(mapStreamState({ state: "ready", readyToStream: true }), "ready");
  assert.equal(mapStreamState({ state: null, readyToStream: false }), "missing");
  assert.equal(mapStreamState({ state: "downloading", readyToStream: false }), "processing");
  assert.equal(mapStreamState({ state: "queued", readyToStream: false }), "processing");
  assert.equal(mapStreamState({ state: "something-new", readyToStream: false }), "processing");
});

test("deleteAsset：404 は not_found、200 は deleted、500 は CloudflareApiError（status 500）", async () => {
  const statuses: Record<string, number> = { a: 404, b: 200, c: 500 };
  const { calls, impl } = fakeFetch((call) => {
    const status = statuses[call.url.split("/").pop()!];
    if (status === 404) return notFound();
    if (status === 500) return { status: 500, json: { success: false, errors: [{ code: 9000, message: "boom" }], result: null } };
    return ok({});
  });
  const store = createCloudflareMediaStore(fullConfig(), createCloudflareApi(apiConfig, impl));
  assert.equal(await store.deleteAsset("cf_images", "a"), "not_found");
  assert.equal(await store.deleteAsset("cf_images", "b"), "deleted");
  assert.equal(calls[1].method, "DELETE");
  assert.equal(calls[1].url, `${base}/images/v1/b`);
  assert.equal(await store.deleteAsset("cf_stream", "a"), "not_found");
  await assert.rejects(
    () => store.deleteAsset("cf_stream", "c"),
    (error: unknown) => {
      assert.ok(error instanceof CloudflareApiError);
      assert.equal(error.status, 500);
      assert.ok(!error.message.includes("secret-token"));
      return true;
    },
  );
});

test("deleteImage：200 でも本文が JSON として読めなければ CloudflareApiError", async () => {
  const api = createCloudflareApi(apiConfig, fakeFetch(() => ({ raw: "<html>oops</html>" })).impl);
  await assert.rejects(
    () => api.deleteImage("a"),
    (error: unknown) => error instanceof CloudflareApiError && error.status === 200,
  );
});

test("deleteStreamVideo：200 で本文が空なら deleted、空でなく読めない本文は CloudflareApiError", async () => {
  const empty = createCloudflareApi(apiConfig, fakeFetch(() => ({ raw: "" })).impl);
  assert.equal(await empty.deleteStreamVideo("a"), "deleted");
  const broken = createCloudflareApi(apiConfig, fakeFetch(() => ({ raw: "<html>oops</html>" })).impl);
  await assert.rejects(
    () => broken.deleteStreamVideo("a"),
    (error: unknown) => error instanceof CloudflareApiError && error.status === 200,
  );
});

test("signedImageUrl：期限は now の1時間後で、imagedelivery.net の URL になる", () => {
  const store = createCloudflareMediaStore(fullConfig(), createCloudflareApi(apiConfig, fakeFetch(() => ok({})).impl));
  const now = new Date("2026-10-25T00:00:00.000Z");
  const url = new URL(store.signedImageUrl("img-1", "thumb", now));
  assert.equal(url.origin + url.pathname, "https://imagedelivery.net/hash1/img-1/thumb");
  assert.equal(url.searchParams.get("exp"), String(Math.floor(now.getTime() / 1000) + 3600));
  assert.ok(url.searchParams.get("sig"));
});

test("signedStreamUrls：トークンの exp は now の1時間後", () => {
  const store = createCloudflareMediaStore(fullConfig(), createCloudflareApi(apiConfig, fakeFetch(() => ok({})).impl));
  const now = new Date("2026-10-25T00:00:00.000Z");
  const urls = store.signedStreamUrls("vid-1", now);
  assert.ok(urls.manifestUrl.startsWith("https://customer-code1.cloudflarestream.com/"));
  const token = urls.manifestUrl.split("/")[3];
  const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
  assert.equal(payload.sub, "vid-1");
  assert.equal(payload.exp, Math.floor(now.getTime() / 1000) + 3600);
});

test("ダミー：createUpload で awaiting_upload の資産ができ、setState と failNextDelete が効く", async () => {
  const store = createFakeMediaStore();
  const input = { kind: "photo" as const, userId: "u1", mediaId: "m1", expiresAt: new Date() };
  const a = await store.createUpload(input);
  const b = await store.createUpload({ ...input, kind: "video" });
  assert.notEqual(a.assetId, b.assetId);
  assert.equal(a.provider, "cf_images");
  assert.equal(b.provider, "cf_stream");
  assert.ok(a.uploadUrl);
  assert.deepEqual(await store.getAssetState(a.provider, a.assetId), { state: "awaiting_upload" });

  store.setState(a.assetId, { state: "ready", width: 10, height: 20 });
  assert.deepEqual(await store.getAssetState(a.provider, a.assetId), { state: "ready", width: 10, height: 20 });
  assert.deepEqual(await store.getAssetState("cf_images", "unknown"), { state: "missing" });

  store.failNextDelete(new Error("fail once"));
  await assert.rejects(() => store.deleteAsset(a.provider, a.assetId), /fail once/);
  assert.equal(await store.deleteAsset(a.provider, a.assetId), "deleted");
  assert.equal(store.assets.has(a.assetId), false);
  assert.equal(await store.deleteAsset(a.provider, a.assetId), "not_found");
});

// 署名用の鍵を含む設定（テスト用に毎回作る）
function fullConfig() {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwkBase64 = Buffer.from(JSON.stringify(privateKey.export({ format: "jwk" }))).toString("base64");
  return {
    ...apiConfig,
    imagesAccountHash: "hash1",
    imagesSigningKey: "img-key",
    streamCustomerCode: "code1",
    streamSigningKeyId: "kid1",
    streamSigningJwk: jwkBase64,
  };
}
