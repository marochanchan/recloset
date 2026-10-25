// 削除待ちの処理（lib/media/deletion-queue.ts）の自動テスト。ネットワークにも DB にも接続しない。
//
// 実行方法:
//   node --test scripts/test-media-deletion-queue.mts

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

const { processMediaDeletionQueue } = await import("../lib/media/deletion-queue.ts");
const { createFakeMediaStore } = await import("../lib/media/fake-media-store.ts");
const { CloudflareApiError } = await import("../lib/media/cloudflare-api.ts");

type Row = {
  id: string;
  claimToken: string;
  provider: "cf_images" | "cf_stream";
  providerAssetId: string;
  attempts: number;
};
const row = (n: number): Row => ({
  id: `id${n}`,
  claimToken: `token${n}`,
  provider: "cf_images",
  providerAssetId: `asset${n}`,
  attempts: 0,
});

function setup(rows: Row[]) {
  const finishCalls: Array<[string, string, boolean, string | null]> = [];
  const claimLimits: number[] = [];
  const store = createFakeMediaStore();
  const deps = {
    claim: async (limit: number) => {
      claimLimits.push(limit);
      return rows;
    },
    finish: async (id: string, token: string, ok: boolean, error: string | null) => {
      finishCalls.push([id, token, ok, error]);
      return true;
    },
    store,
  };
  return { deps, finishCalls, claimLimits, store };
}

test("Cloudflare の削除が成功：取り出したときの claimToken で finish(ok=true)、deleted=1", async () => {
  const { deps, finishCalls, claimLimits } = setup([row(1)]);
  const result = await processMediaDeletionQueue(deps);
  assert.deepEqual(result, { deleted: 1, failed: 0 });
  assert.deepEqual(finishCalls, [["id1", "token1", true, null]]);
  assert.deepEqual(claimLimits, [20]);
});

test("Cloudflare が not_found：成功として扱う", async () => {
  // 何も登録していない asset の削除は not_found になる
  const { deps, finishCalls } = setup([row(1)]);
  const result = await processMediaDeletionQueue(deps, 5);
  assert.deepEqual(result, { deleted: 1, failed: 0 });
  assert.deepEqual(finishCalls, [["id1", "token1", true, null]]);
});

test("Cloudflare が例外：finish(ok=false, 安全な説明)、failed=1。ほかの行は続けて処理する", async () => {
  const { deps, finishCalls, store } = setup([row(1), row(2)]);
  store.failNextDelete(new CloudflareApiError("secret external text", 503));
  const result = await processMediaDeletionQueue(deps);
  assert.deepEqual(result, { deleted: 1, failed: 1 });
  assert.equal(finishCalls.length, 2);
  assert.deepEqual(finishCalls[0].slice(0, 3), ["id1", "token1", false]);
  assert.match(String(finishCalls[0][3]), /CloudflareApiError/);
  assert.match(String(finishCalls[0][3]), /503/);
  assert.doesNotMatch(String(finishCalls[0][3]), /secret external text/);
  assert.deepEqual(finishCalls[1], ["id2", "token2", true, null]);
});
