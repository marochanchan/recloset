// 端末の写真を複数選ぶときの上限・足し方の自動テスト。
//   node --test scripts/test-outfit-photo-selection.mts

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

const { photoRoom, planPhotoSelection, mergePickedPhotos, photoSelectionNotice } = await import(
  "../lib/outfits/photo-selection.ts"
);

const frame = (id: string, timeSec = 0) => ({ id, timeSec, image: id });

test("photoRoom: 6枚までの残り", () => {
  assert.equal(photoRoom(0), 6);
  assert.equal(photoRoom(4), 2);
  assert.equal(photoRoom(6), 0);
  assert.equal(photoRoom(9), 0);
});

test("planPhotoSelection: 入るだけ取って、残りは無視する", () => {
  assert.deepEqual(planPhotoSelection(0, 3), { take: 3, ignored: 0 });
  assert.deepEqual(planPhotoSelection(0, 8), { take: 6, ignored: 2 });
  assert.deepEqual(planPhotoSelection(4, 3), { take: 2, ignored: 1 });
  assert.deepEqual(planPhotoSelection(6, 2), { take: 0, ignored: 2 });
  assert.deepEqual(planPhotoSelection(2, 0), { take: 0, ignored: 0 });
});

test("mergePickedPhotos: 動画のコマの後ろに選んだ順で足す（timeSec は 0）", () => {
  const { list, added } = mergePickedPhotos([frame("v1", 2.5)], [
    { id: "p1", image: "p1" },
    { id: "p2", image: "p2" },
  ]);
  assert.equal(added, 2);
  assert.deepEqual(list.map((f) => f.id), ["v1", "p1", "p2"]);
  assert.equal(list[1].timeSec, 0);
});

test("mergePickedPhotos: 上限（6枚）を超える分は足さない", () => {
  const base = [frame("a"), frame("b"), frame("c"), frame("d"), frame("e")];
  const { list, added } = mergePickedPhotos(base, [
    { id: "p1", image: "p1" },
    { id: "p2", image: "p2" },
  ]);
  assert.equal(added, 1);
  assert.equal(list.length, 6);
  assert.equal(list[5].id, "p1");
});

test("photoSelectionNotice: あふれと失敗の一言（なければ null）", () => {
  assert.equal(photoSelectionNotice({ ignored: 0, failed: 0 }), null);
  assert.equal(photoSelectionNotice({ ignored: 2, failed: 0 }), "選べるのは6枚までです。2枚は追加しませんでした");
  assert.equal(photoSelectionNotice({ ignored: 0, failed: 1 }), "1枚は開けませんでした");
  assert.equal(
    photoSelectionNotice({ ignored: 1, failed: 2 }),
    "選べるのは6枚までです。1枚は追加しませんでした。2枚は開けませんでした",
  );
});
