// 署名付きURLキャッシュ（lib/signed-image-url-cache.ts）の自動テスト。
// Supabase・ネットワークには接続せず、署名は架空の関数で置き換える。
//
// 実行方法:
//   node --test scripts/test-signed-image-url-cache.mts

import assert from "node:assert/strict";
import { beforeEach, describe, mock, test } from "node:test";
import {
  forgetPublicSignedUrls,
  forgetSignedUrls,
  getSignedUrlCacheStats,
  resetSignedUrlCache,
  resolveSignedUrls,
  SIGNED_URL_CACHE_MAX_ENTRIES,
  SIGNED_URL_REUSE_MS,
  type SignedUrlScope,
} from "../lib/signed-image-url-cache.ts";

const USER_A = "aaaaaaaa-0000-0000-0000-000000000001";
const USER_B = "bbbbbbbb-0000-0000-0000-000000000002";
const A_IMG_1 = `${USER_A}/item1/one.jpg`;
const A_IMG_2 = `${USER_A}/item1/two.jpg`;
const B_IMG_1 = `${USER_B}/item9/nine.jpg`;

const privateA: SignedUrlScope = { kind: "private", userId: USER_A };
const privateB: SignedUrlScope = { kind: "private", userId: USER_B };
const publicScope: SignedUrlScope = { kind: "public" };

// 呼ばれるたびに別のトークンを返す（Supabaseと同じく毎回URLが変わる）
function createFakeSigner(options: { deny?: Set<string> } = {}) {
  let counter = 0;
  const calls: string[][] = [];
  const sign = async (paths: string[]) => {
    calls.push([...paths]);
    const result = new Map<string, string>();
    for (const path of paths) {
      if (options.deny?.has(path)) continue;
      counter += 1;
      result.set(path, `https://example.test/${path}?token=t${counter}`);
    }
    return result;
  };
  return { sign, calls };
}

beforeEach(() => {
  resetSignedUrlCache();
  mock.timers.reset();
});

describe("再利用", () => {
  test("再利用時間内は同じURLを返し、署名を呼ばない", async () => {
    mock.timers.enable({ apis: ["Date"], now: 1_000_000 });
    const signer = createFakeSigner();
    const first = await resolveSignedUrls([A_IMG_1, A_IMG_2], privateA, signer.sign, "t");
    mock.timers.tick(SIGNED_URL_REUSE_MS - 1);
    const second = await resolveSignedUrls([A_IMG_1, A_IMG_2], privateA, signer.sign, "t");
    assert.deepEqual([...second], [...first]);
    assert.equal(signer.calls.length, 1);
    assert.deepEqual(getSignedUrlCacheStats(), { hits: 2, misses: 2, rejected: 0, size: 2 });
  });

  test("再利用時間を過ぎたら新しく署名する", async () => {
    mock.timers.enable({ apis: ["Date"], now: 1_000_000 });
    const signer = createFakeSigner();
    const first = await resolveSignedUrls([A_IMG_1], privateA, signer.sign, "t");
    mock.timers.tick(SIGNED_URL_REUSE_MS);
    const second = await resolveSignedUrls([A_IMG_1], privateA, signer.sign, "t");
    assert.notEqual(second.get(A_IMG_1), first.get(A_IMG_1));
    assert.equal(signer.calls.length, 2);
  });

  test("キャッシュにないものだけをまとめて1回で署名する", async () => {
    const signer = createFakeSigner();
    await resolveSignedUrls([A_IMG_1], privateA, signer.sign, "t");
    await resolveSignedUrls([A_IMG_1, A_IMG_2, A_IMG_2], privateA, signer.sign, "t");
    assert.deepEqual(signer.calls, [[A_IMG_1], [A_IMG_2]]);
  });

  test("時計が戻った場合は再利用しない", async () => {
    mock.timers.enable({ apis: ["Date"], now: 1_000_000 });
    const signer = createFakeSigner();
    await resolveSignedUrls([A_IMG_1], privateA, signer.sign, "t");
    mock.timers.setTime(500_000);
    await resolveSignedUrls([A_IMG_1], privateA, signer.sign, "t");
    assert.equal(signer.calls.length, 2);
  });
});

describe("ユーザー間の分離", () => {
  test("本人のフォルダ以外のパスは署名もキャッシュもしない", async () => {
    const signer = createFakeSigner();
    const result = await resolveSignedUrls([A_IMG_1, B_IMG_1], privateA, signer.sign, "t");
    assert.deepEqual([...result.keys()], [A_IMG_1]);
    assert.deepEqual(signer.calls, [[A_IMG_1]]);
    assert.equal(getSignedUrlCacheStats().rejected, 1);
  });

  test("Aのキャッシュ済みURLはBには返らない（Bのフォルダでないため拒否）", async () => {
    const signer = createFakeSigner();
    await resolveSignedUrls([A_IMG_1], privateA, signer.sign, "t");
    const forB = await resolveSignedUrls([A_IMG_1], privateB, signer.sign, "t");
    assert.equal(forB.size, 0);
    assert.equal(signer.calls.length, 1);
  });

  test("ユーザーIDの前方一致だけでは通らない（区切りの / まで一致が必要）", async () => {
    const signer = createFakeSigner();
    const lookalike = `${USER_A}x/item/evil.jpg`;
    const result = await resolveSignedUrls([lookalike], privateA, signer.sign, "t");
    assert.equal(result.size, 0);
    assert.equal(signer.calls.length, 0);
  });

  test("空のユーザーIDでは何も署名しない", async () => {
    const signer = createFakeSigner();
    const result = await resolveSignedUrls(
      [A_IMG_1, `/x.jpg`],
      { kind: "private", userId: "" },
      signer.sign,
      "t",
    );
    assert.equal(result.size, 0);
    assert.equal(signer.calls.length, 0);
  });

  test("privateのキャッシュはpublicに漏れない", async () => {
    const signer = createFakeSigner();
    const own = await resolveSignedUrls([A_IMG_1], privateA, signer.sign, "t");
    const pub = await resolveSignedUrls([A_IMG_1], publicScope, signer.sign, "t");
    assert.notEqual(pub.get(A_IMG_1), own.get(A_IMG_1));
    assert.equal(signer.calls.length, 2);
  });

  test("publicのキャッシュはprivateに使われない", async () => {
    const signer = createFakeSigner();
    const pub = await resolveSignedUrls([A_IMG_1], publicScope, signer.sign, "t");
    const own = await resolveSignedUrls([A_IMG_1], privateA, signer.sign, "t");
    assert.notEqual(own.get(A_IMG_1), pub.get(A_IMG_1));
    assert.equal(signer.calls.length, 2);
  });
});

describe("公開画像", () => {
  test("署名できなかった（非公開の）画像はキャッシュしない", async () => {
    const signer = createFakeSigner({ deny: new Set([B_IMG_1]) });
    const first = await resolveSignedUrls([A_IMG_1, B_IMG_1], publicScope, signer.sign, "t");
    assert.deepEqual([...first.keys()], [A_IMG_1]);
    await resolveSignedUrls([B_IMG_1], publicScope, signer.sign, "t");
    assert.deepEqual(signer.calls, [[A_IMG_1, B_IMG_1], [B_IMG_1]]);
  });

  test("公開解除時にpublicのURLだけを捨てる", async () => {
    const signer = createFakeSigner();
    const own = await resolveSignedUrls([A_IMG_1], privateA, signer.sign, "t");
    const pub = await resolveSignedUrls([A_IMG_2], publicScope, signer.sign, "t");
    forgetPublicSignedUrls();
    const ownAgain = await resolveSignedUrls([A_IMG_1], privateA, signer.sign, "t");
    const pubAgain = await resolveSignedUrls([A_IMG_2], publicScope, signer.sign, "t");
    assert.equal(ownAgain.get(A_IMG_1), own.get(A_IMG_1));
    assert.notEqual(pubAgain.get(A_IMG_2), pub.get(A_IMG_2));
  });

  test("公開解除後に再び公開しても、anonで署名できなければ返さない", async () => {
    const deny = new Set<string>();
    const signer = createFakeSigner({ deny });
    await resolveSignedUrls([A_IMG_1], publicScope, signer.sign, "t");
    forgetPublicSignedUrls();
    deny.add(A_IMG_1); // 非公開になり、Storageポリシーで署名できない
    const after = await resolveSignedUrls([A_IMG_1], publicScope, signer.sign, "t");
    assert.equal(after.size, 0);
  });
});

describe("削除・失敗・上限", () => {
  test("削除したパスは両方のスコープから捨てる", async () => {
    const signer = createFakeSigner();
    await resolveSignedUrls([A_IMG_1, A_IMG_2], privateA, signer.sign, "t");
    await resolveSignedUrls([A_IMG_1], publicScope, signer.sign, "t");
    forgetSignedUrls([A_IMG_1]);
    assert.equal(getSignedUrlCacheStats().size, 1);
  });

  test("署名が例外になっても空の結果を返し、キャッシュしない", async () => {
    const original = console.error;
    console.error = () => {};
    try {
      const failing = async () => {
        throw new Error("network");
      };
      const result = await resolveSignedUrls([A_IMG_1], privateA, failing, "t");
      assert.equal(result.size, 0);
      assert.equal(getSignedUrlCacheStats().size, 0);
    } finally {
      console.error = original;
    }
  });

  test("上限件数を超えたら最も長く使われていないものから捨てる", async () => {
    const signer = createFakeSigner();
    const paths = Array.from(
      { length: SIGNED_URL_CACHE_MAX_ENTRIES + 1 },
      (_, i) => `${USER_A}/bulk/${i}.jpg`,
    );
    const first = paths[0];
    const second = paths[1];
    await resolveSignedUrls(paths.slice(0, SIGNED_URL_CACHE_MAX_ENTRIES), privateA, signer.sign, "t");
    // 1件目を使い直して「最近使った」にする → 2件目が最も古くなる
    await resolveSignedUrls([first], privateA, signer.sign, "t");
    await resolveSignedUrls([paths[SIGNED_URL_CACHE_MAX_ENTRIES]], privateA, signer.sign, "t");
    assert.equal(getSignedUrlCacheStats().size, SIGNED_URL_CACHE_MAX_ENTRIES);
    const callsBefore = signer.calls.length;
    await resolveSignedUrls([first], privateA, signer.sign, "t");
    assert.equal(signer.calls.length, callsBefore, "1件目は残っている");
    await resolveSignedUrls([second], privateA, signer.sign, "t");
    assert.equal(signer.calls.length, callsBefore + 1, "2件目は捨てられている");
  });
});
