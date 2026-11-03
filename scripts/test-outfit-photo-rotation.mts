// 記録の画面で送る前に写真を回す状態（lib/outfits/photo-rotation.ts）の自動テスト。
//
// 実行方法:
//   node --test scripts/test-outfit-photo-rotation.mts

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

const { rotateStaged, stagePhoto } = await import("../lib/outfits/photo-rotation.ts");

test("stagePhoto は向き 0 から始まる", () => {
  const s = stagePhoto("src");
  assert.equal(s.rotation, 0);
  assert.equal(s.source, "src");
});

test("rotateStaged は 90 度ずつ時計回りに進み、4回で戻る", () => {
  let s = stagePhoto("src");
  const seen: number[] = [];
  for (let i = 0; i < 4; i++) {
    s = rotateStaged(s);
    seen.push(s.rotation);
  }
  assert.deepEqual(seen, [90, 180, 270, 0]);
  assert.equal(s.source, "src");
});

test("rotateStaged は元を変えない", () => {
  const s = stagePhoto("src");
  rotateStaged(s);
  assert.equal(s.rotation, 0);
});
