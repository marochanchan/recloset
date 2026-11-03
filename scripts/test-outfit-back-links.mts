// 戻り先とリンク先の決め方（lib/outfits/back-links.ts）の自動テスト。
//
// 実行方法:
//   node --test scripts/test-outfit-back-links.mts

import assert from "node:assert/strict";
import { test } from "node:test";

const { newLookBackLink, itemBackLink, parseUuidParam } = await import(
  "../lib/outfits/back-links.ts"
);

const ID = "123e4567-e89b-12d3-a456-426614174000";

test("parseUuidParam は UUID の文字列だけ通す", () => {
  assert.equal(parseUuidParam(ID), ID);
  assert.equal(parseUuidParam("abc"), null);
  assert.equal(parseUuidParam(undefined), null);
  assert.equal(parseUuidParam([ID, ID]), null);
});

test("記録の画面：正しい item なら服の詳細へ、それ以外は着画の一覧へ", () => {
  assert.deepEqual(newLookBackLink(ID), { href: `/protected/items/${ID}`, label: "服へ戻る" });
  assert.deepEqual(newLookBackLink(null), { href: "/protected/looks", label: "着画" });
});

test("服の詳細：正しい from なら着画へ、それ以外はクローゼットへ", () => {
  assert.deepEqual(itemBackLink(ID), { href: `/protected/looks/${ID}`, label: "着画" });
  assert.deepEqual(itemBackLink(null), { href: "/protected/items", label: "クローゼット" });
});
