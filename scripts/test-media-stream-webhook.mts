// Stream webhook の処理（lib/media/stream-webhook.ts）の自動テスト。ネットワークには接続しない。
//
// 実行方法:
//   node --test scripts/test-media-stream-webhook.mts

import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
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

const { handleStreamWebhook } = await import("../lib/media/stream-webhook.ts");

const SECRET = "whsec";
const TIME = 1_700_000_000;
const NOW = new Date((TIME + 10) * 1000);

// 本文は公式と同じ形
function body(overrides: { state?: string; readyToStream?: boolean } = {}) {
  return JSON.stringify({
    uid: "v1",
    readyToStream: overrides.readyToStream ?? true,
    status: { state: overrides.state ?? "ready", pctComplete: "100.000000" },
    input: { width: 1080, height: 1920 },
    duration: 5.2,
    meta: { name: "x.mp4" },
  });
}
function header(raw: string, secret = SECRET) {
  const sig = createHmac("sha256", secret).update(`${TIME}.${raw}`).digest("hex");
  return `time=${TIME},sig1=${sig}`;
}
type Payload = { assetId: string; status: string; width: number | null; height: number | null; durationSec: number | null };
function recorder(result: "applied" | "ignored" | "duplicate" = "applied") {
  const calls: Payload[] = [];
  return {
    calls,
    apply: async (p: Payload) => {
      calls.push(p);
      return result;
    },
  };
}

test("正しい署名：apply を呼び、200 と結果を返す", async () => {
  const raw = body();
  const r = recorder("applied");
  const res = await handleStreamWebhook({ header: header(raw), rawBody: raw, secret: SECRET, now: NOW, apply: r.apply });
  assert.deepEqual(res, { status: 200, result: "applied" });
  assert.deepEqual(r.calls, [{ assetId: "v1", status: "ready", width: 1080, height: 1920, durationSec: 5.2 }]);
});

test("署名が違う：401 で、apply を呼ばない", async () => {
  const raw = body();
  const r = recorder();
  const res = await handleStreamWebhook({ header: header(raw, "other"), rawBody: raw, secret: SECRET, now: NOW, apply: r.apply });
  assert.equal(res.status, 401);
  assert.equal(r.calls.length, 0);
});

test("知らない uid（apply が ignored）：200 で ignored", async () => {
  const raw = body();
  const r = recorder("ignored");
  const res = await handleStreamWebhook({ header: header(raw), rawBody: raw, secret: SECRET, now: NOW, apply: r.apply });
  assert.deepEqual(res, { status: 200, result: "ignored" });
});

test("同じ通知の2回目（apply が duplicate）：200", async () => {
  const raw = body();
  const r = recorder("duplicate");
  const res = await handleStreamWebhook({ header: header(raw), rawBody: raw, secret: SECRET, now: NOW, apply: r.apply });
  assert.deepEqual(res, { status: 200, result: "duplicate" });
});

test("本文が JSON でない：400（署名は正しい）", async () => {
  const raw = "not json";
  const r = recorder();
  const res = await handleStreamWebhook({ header: header(raw), rawBody: raw, secret: SECRET, now: NOW, apply: r.apply });
  assert.equal(res.status, 400);
  assert.equal(r.calls.length, 0);
});

test("uid がない：400", async () => {
  const raw = JSON.stringify({ status: { state: "ready" } });
  const r = recorder();
  const res = await handleStreamWebhook({ header: header(raw), rawBody: raw, secret: SECRET, now: NOW, apply: r.apply });
  assert.equal(res.status, 400);
  assert.equal(r.calls.length, 0);
});

test("state が ready でも readyToStream が false：apply には processing を渡す", async () => {
  const raw = body({ readyToStream: false });
  const r = recorder();
  await handleStreamWebhook({ header: header(raw), rawBody: raw, secret: SECRET, now: NOW, apply: r.apply });
  assert.equal(r.calls[0].status, "processing");
});

test("pendingupload（awaiting_upload になる通知）：apply を呼ばず 200 と ignored", async () => {
  const raw = body({ state: "pendingupload", readyToStream: false });
  const r = recorder();
  const res = await handleStreamWebhook({ header: header(raw), rawBody: raw, secret: SECRET, now: NOW, apply: r.apply });
  assert.deepEqual(res, { status: 200, result: "ignored" });
  assert.equal(r.calls.length, 0);
});

test("error の通知：failed を渡す", async () => {
  const raw = body({ state: "error", readyToStream: false });
  const r = recorder();
  await handleStreamWebhook({ header: header(raw), rawBody: raw, secret: SECRET, now: NOW, apply: r.apply });
  assert.equal(r.calls[0].status, "failed");
});
