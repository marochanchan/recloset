// Cloudflare の署名・設定読み込み（lib/media/cloudflare-signing.ts・
// lib/media/cloudflare-config.ts）の自動テスト。ネットワークには接続しない。
//
// 実行方法:
//   node --test scripts/test-cloudflare-signing.mts

import assert from "node:assert/strict";
import { createHmac, createVerify, generateKeyPairSync } from "node:crypto";
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
  buildStreamUrls,
  createStreamToken,
  signImagesDeliveryUrl,
  verifyStreamWebhookSignature,
} = await import("../lib/media/cloudflare-signing.ts");
const { readCloudflareApiConfig, readCloudflareConfig, readStreamWebhookSecret } =
  await import("../lib/media/cloudflare-config.ts");

test("Images の署名付き URL は path?exp の HMAC-SHA256 を sig に付ける", () => {
  const url = new URL(signImagesDeliveryUrl({ accountHash: "hash123", imageId: "img1", variant: "thumb", signingKey: "test-key", expiresAt: new Date(1_700_000_000_000) }));
  assert.equal(url.origin + url.pathname, "https://imagedelivery.net/hash123/img1/thumb");
  assert.equal(url.searchParams.get("exp"), "1700000000");
  const expected = createHmac("sha256", "test-key").update("/hash123/img1/thumb?exp=1700000000").digest("hex");
  assert.equal(url.searchParams.get("sig"), expected);
});

test("Stream のトークンは kid 付きの RS256 で、公開鍵で検証できる", () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwkBase64 = Buffer.from(JSON.stringify(privateKey.export({ format: "jwk" }))).toString("base64");
  const token = createStreamToken({ videoUid: "vid1", keyId: "kid1", jwkBase64, expiresAt: new Date(1_700_003_600_000), now: new Date(1_700_000_000_000) });
  const [h, p, s] = token.split(".");
  assert.deepEqual(JSON.parse(Buffer.from(h, "base64url").toString()), { alg: "RS256", kid: "kid1" });
  const payload = JSON.parse(Buffer.from(p, "base64url").toString());
  assert.equal(payload.sub, "vid1"); assert.equal(payload.kid, "kid1"); assert.equal(payload.exp, 1_700_003_600);
  assert.equal(payload.nbf, 1_700_000_000 - 60);
  assert.ok(createVerify("RSA-SHA256").update(`${h}.${p}`).verify(publicKey, Buffer.from(s, "base64url")));
});

test("Stream の URL は customer コードとトークンから作る", () => {
  const u = buildStreamUrls({ customerCode: "abc", token: "TKN" });
  assert.equal(u.manifestUrl, "https://customer-abc.cloudflarestream.com/TKN/manifest/video.m3u8");
  assert.equal(u.thumbnailUrl, "https://customer-abc.cloudflarestream.com/TKN/thumbnails/thumbnail.jpg?time=1s");
  assert.equal(u.previewGifUrl, "https://customer-abc.cloudflarestream.com/TKN/thumbnails/thumbnail.gif?time=0s&duration=3s");
});

// webhook: 秘密 "whsec"、本文 '{"uid":"v1"}'、time=1700000000、now=1700000100
const WH_SECRET = "whsec";
const WH_BODY = '{"uid":"v1"}';
const WH_TIME = 1_700_000_000;
function whHeader(secret: string, body: string) {
  const sig = createHmac("sha256", secret).update(`${WH_TIME}.${body}`).digest("hex");
  return `time=${WH_TIME},sig1=${sig}`;
}
const whNow = (sec: number) => new Date(sec * 1000);

test("webhook：正しい署名は ok", () => {
  const r = verifyStreamWebhookSignature({ header: whHeader(WH_SECRET, WH_BODY), rawBody: WH_BODY, secret: WH_SECRET, now: whNow(1_700_000_100) });
  assert.deepEqual(r, { ok: true });
});

test("webhook：本文が1文字違うと mismatch", () => {
  const r = verifyStreamWebhookSignature({ header: whHeader(WH_SECRET, WH_BODY), rawBody: '{"uid":"v2"}', secret: WH_SECRET, now: whNow(1_700_000_100) });
  assert.deepEqual(r, { ok: false, reason: "mismatch" });
});

test("webhook：秘密が違うと mismatch", () => {
  const r = verifyStreamWebhookSignature({ header: whHeader(WH_SECRET, WH_BODY), rawBody: WH_BODY, secret: "other", now: whNow(1_700_000_100) });
  assert.deepEqual(r, { ok: false, reason: "mismatch" });
});

test("webhook：301秒より古いと expired", () => {
  const header = whHeader(WH_SECRET, WH_BODY);
  const old = verifyStreamWebhookSignature({ header, rawBody: WH_BODY, secret: WH_SECRET, now: whNow(1_700_000_301) });
  assert.deepEqual(old, { ok: false, reason: "expired" });
  const edge = verifyStreamWebhookSignature({ header, rawBody: WH_BODY, secret: WH_SECRET, now: whNow(1_700_000_300) });
  assert.deepEqual(edge, { ok: true });
});

test("webhook：ヘッダーがないと missing、形が違うと malformed", () => {
  const base = { rawBody: WH_BODY, secret: WH_SECRET, now: whNow(1_700_000_100) };
  assert.deepEqual(verifyStreamWebhookSignature({ ...base, header: null }), { ok: false, reason: "missing" });
  assert.deepEqual(verifyStreamWebhookSignature({ ...base, header: "sig1=abc" }), { ok: false, reason: "malformed" });
});

test("設定：API 用は、アカウント ID とトークンだけの環境で読める", () => {
  assert.deepEqual(readCloudflareApiConfig({ CLOUDFLARE_ACCOUNT_ID: "a", CLOUDFLARE_API_TOKEN: "t" }), { accountId: "a", apiToken: "t" });
});

test("設定：署名用は、足りない環境変数の名前をすべて挙げて例外にする", () => {
  assert.throws(
    () => readCloudflareConfig({ CLOUDFLARE_ACCOUNT_ID: "a", CLOUDFLARE_API_TOKEN: "t" }),
    (e: Error) =>
      e.message.includes("CLOUDFLARE_IMAGES_ACCOUNT_HASH") &&
      e.message.includes("CLOUDFLARE_STREAM_SIGNING_JWK") &&
      !/\bt\b/.test(e.message.replace(/CLOUDFLARE_\w+/g, "")),
  );
});

test("設定：webhook の秘密だけを読める", () => {
  assert.throws(() => readStreamWebhookSecret({}), /CLOUDFLARE_STREAM_WEBHOOK_SECRET/);
  assert.equal(readStreamWebhookSecret({ CLOUDFLARE_STREAM_WEBHOOK_SECRET: "s" }), "s");
});

test("webhook：301秒より未来も expired（300 ちょうど未来は ok）", () => {
  const header = whHeader(WH_SECRET, WH_BODY);
  const edge = verifyStreamWebhookSignature({ header, rawBody: WH_BODY, secret: WH_SECRET, now: whNow(1_699_999_700) });
  assert.deepEqual(edge, { ok: true });
  const future = verifyStreamWebhookSignature({ header, rawBody: WH_BODY, secret: WH_SECRET, now: whNow(1_699_999_699) });
  assert.deepEqual(future, { ok: false, reason: "expired" });
});
