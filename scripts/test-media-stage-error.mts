// 失敗の表示（scripts/lib/stage-error.mts）の自動テスト。秘密が画面に出ないことを確かめる。
//
// 実行方法:
//   node --test scripts/test-media-stage-error.mts

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

const { formatStageError, StageFailure } = await import("./lib/stage-error.mts");
const { CloudflareApiError } = await import("../lib/media/cloudflare-api.ts");

const SECRET = "PLANTED-SECRET-123";

test("Cloudflare のエラー：段階・HTTP の状態・番号だけで、文言や秘密は出ない", () => {
  const error = new CloudflareApiError(`Cloudflare API エラー status=400 10000: bad url https://x/?x-vercel-protection-bypass=${SECRET}`, 400, [10000, 5400]);
  const out = formatStageError("3. 通知先の登録", error);
  assert.ok(out.includes("3. 通知先の登録"));
  assert.ok(out.includes("400"));
  assert.ok(out.includes("10000,5400"));
  assert.ok(!out.includes(SECRET));
  assert.ok(!out.includes("bad url"));
});

test("ほかの例外：種類の名前だけで、メッセージの秘密は出ない", () => {
  const out = formatStageError("鍵の解析", new TypeError(`invalid jwk {"d":"${SECRET}"}`));
  assert.ok(out.includes("鍵の解析"));
  assert.ok(out.includes("TypeError"));
  assert.ok(!out.includes(SECRET));
});

test("例外でない値や変な名前でも、秘密は出ない", () => {
  assert.ok(!formatStageError("s", SECRET).includes(SECRET));
  const weird = new Error("m");
  weird.name = `Bad ${SECRET}`;
  assert.ok(!formatStageError("s", weird).includes(SECRET));
});

test("自分で書いたメッセージ（StageFailure）はそのまま出す", () => {
  assert.equal(formatStageError("段階", new StageFailure("署名なしで取得できてしまいます")), "段階：署名なしで取得できてしまいます");
});
