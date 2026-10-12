// 写真からまとめて登録する画面の状態の判定（lib/photo-batch-state.ts）と、
// 変換の同時実行数の制御（createConcurrencyLimiter）の自動テスト。
// DB・ネットワーク・ブラウザには接続しない。
//
// 実行方法:
//   node --test scripts/test-photo-batch-state.mts

import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { describe, test } from "node:test";
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
  canDiscardPhoto,
  canStartPhotoRegistration,
  describePhotoFailure,
  getPhotoBatchLeaveMessage,
  getPhotoRegisterButtonLabel,
  isPhotoLocked,
  isPhotoToRegister,
  planPhotoAddition,
  PHOTO_ENTRY_PENDING_NOTE,
  resolveDiscardResult,
  resolveEntryLeaveGuards,
  shouldConfirmPhotoBatchLeave,
  summarizePhotoBatch,
} = await import("../lib/photo-batch-state.ts");
const { createConcurrencyLimiter, PHOTO_PROCESSING_CONCURRENCY } = await import(
  "../lib/photo-batch-registration.ts"
);

type Status = "processing" | "ready" | "saving" | "saved" | "failed";
const TARGET = { itemId: "i", imagePath: "p" };
const item = (
  status: Status,
  { target = status === "ready" || status === "processing" ? null : TARGET, retryable = true } = {},
) => ({
  status,
  target,
  failure:
    status === "failed"
      ? { stage: "upload" as const, retryable, reason: retryable ? ("unknown" as const) : ("denied" as const) }
      : null,
});
const many = (n: number, status: Status = "ready") => Array.from({ length: n }, () => item(status));

describe("写真の追加（合計20枚まで）", () => {
  test("上限までだけ加え、超えた枚数を返す", () => {
    assert.deepEqual(planPhotoAddition(0, 5), { accept: 5, rejected: 0 });
    assert.deepEqual(planPhotoAddition(0, 20), { accept: 20, rejected: 0 });
    assert.deepEqual(planPhotoAddition(0, 21), { accept: 20, rejected: 1 });
    assert.deepEqual(planPhotoAddition(18, 5), { accept: 2, rejected: 3 });
    assert.deepEqual(planPhotoAddition(20, 1), { accept: 0, rejected: 1 });
  });
});

describe("登録を始められるか", () => {
  test("0枚では始められない", () => {
    assert.equal(canStartPhotoRegistration([], false), false);
  });

  test("1枚でも20枚でも同じように始められる", () => {
    assert.equal(canStartPhotoRegistration(many(1), false), true);
    assert.equal(canStartPhotoRegistration(many(20), false), true);
  });

  test("21枚以上は始められない", () => {
    assert.equal(canStartPhotoRegistration(many(21), false), false);
  });

  test("変換中の写真があると始められない", () => {
    assert.equal(canStartPhotoRegistration([item("ready"), item("processing")], false), false);
  });

  test("登録中は始められない（二重送信の防止）", () => {
    assert.equal(canStartPhotoRegistration(many(3), true), false);
  });

  test("すべて保存済み、または再試行できない失敗だけなら始められない", () => {
    assert.equal(canStartPhotoRegistration(many(3, "saved"), false), false);
    assert.equal(
      canStartPhotoRegistration([item("saved"), item("failed", { retryable: false })], false),
      false,
    );
  });

  test("再試行できる失敗が残っていれば、もう一度始められる", () => {
    assert.equal(canStartPhotoRegistration([item("saved"), item("failed")], false), true);
  });
});

describe("登録で送る写真", () => {
  test("待機中と再試行できる失敗だけを送り、保存済み・保存中は送らない", () => {
    assert.equal(isPhotoToRegister(item("ready")), true);
    assert.equal(isPhotoToRegister(item("failed")), true);
    assert.equal(isPhotoToRegister(item("failed", { retryable: false })), false);
    assert.equal(isPhotoToRegister(item("saved")), false);
    assert.equal(isPhotoToRegister(item("saving")), false);
    assert.equal(isPhotoToRegister(item("processing")), false);
  });
});

describe("写真を外す・回転できるか", () => {
  test("登録前の写真は操作できる", () => {
    assert.equal(isPhotoLocked(item("ready")), false);
    assert.equal(isPhotoLocked(item("processing")), false);
  });

  test("保存中・保存済み・一度送った（失敗した）写真は操作できない", () => {
    assert.equal(isPhotoLocked(item("saving")), true);
    assert.equal(isPhotoLocked(item("saved")), true);
    assert.equal(isPhotoLocked(item("failed")), true, "途中まで保存された可能性があるため");
    assert.equal(isPhotoLocked(item("ready", { target: TARGET })), true, "保存先が決まった写真");
  });
});

describe("表示", () => {
  test("件数のまとめ", () => {
    const items = [item("ready"), item("processing"), item("saved"), item("failed"), item("failed", { retryable: false })];
    assert.deepEqual(summarizePhotoBatch(items), {
      total: 5,
      processing: 1,
      saved: 1,
      failed: 2,
      toRegister: 2,
    });
  });

  test("登録ボタンの文言", () => {
    assert.equal(getPhotoRegisterButtonLabel(many(1)), "1着を登録する");
    assert.equal(getPhotoRegisterButtonLabel(many(10)), "10着を登録する");
    assert.equal(
      getPhotoRegisterButtonLabel([item("saved"), item("saved"), item("failed")]),
      "残り1着を登録する",
    );
  });
});

describe("画面を離れるときの確認", () => {
  test("写真がなければ確認しない", () => {
    assert.equal(shouldConfirmPhotoBatchLeave([], false), false);
  });

  test("登録していない写真がある・登録中・失敗が残っているときは確認する", () => {
    assert.equal(shouldConfirmPhotoBatchLeave(many(2), false), true);
    assert.equal(shouldConfirmPhotoBatchLeave(many(2, "saved"), true), true);
    assert.equal(shouldConfirmPhotoBatchLeave([item("saved"), item("failed")], false), true);
  });

  test("すべて保存済みなら確認しない", () => {
    assert.equal(shouldConfirmPhotoBatchLeave(many(3, "saved"), false), false);
  });
});

describe("変換の同時実行数（createConcurrencyLimiter）", () => {
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  test("依頼が別々に届いても、同時に実行するのは2件まで", async () => {
    assert.equal(PHOTO_PROCESSING_CONCURRENCY, 2);
    const run = createConcurrencyLimiter(PHOTO_PROCESSING_CONCURRENCY);
    let active = 0;
    let maxActive = 0;
    const task = (ms: number, value: number) => () =>
      (async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await sleep(ms);
        active -= 1;
        return value;
      })();
    // 最初に3件、少し後に（写真の追加・回転を想定して）さらに3件
    const first = [run(task(15, 1)), run(task(5, 2)), run(task(5, 3))];
    await sleep(2);
    const second = [run(task(5, 4)), run(task(5, 5)), run(task(5, 6))];
    assert.deepEqual(await Promise.all([...first, ...second]), [1, 2, 3, 4, 5, 6]);
    assert.equal(maxActive, 2);
  });

  test("失敗した依頼があっても、残りの依頼は実行する", async () => {
    const run = createConcurrencyLimiter(2);
    const results = await Promise.allSettled([
      run(async () => {
        throw new Error("boom");
      }),
      run(async () => 2),
      run(async () => 3),
    ]);
    assert.deepEqual(
      results.map((r) => r.status),
      ["rejected", "fulfilled", "fulfilled"],
    );
  });
});

describe("失敗の表示と再試行", () => {
  test("再試行できる失敗とできない失敗で、理由の文が変わる", () => {
    assert.match(
      describePhotoFailure({ stage: "upload", retryable: true, reason: "unknown" }),
      /もう一度お試しください/,
    );
    const permanent = [
      describePhotoFailure({ stage: "image", retryable: false, reason: "denied" }),
      describePhotoFailure({ stage: "item", retryable: false, reason: "conflict" }),
      describePhotoFailure({ stage: "upload", retryable: false, reason: "invalid" }),
      describePhotoFailure({ stage: "item", retryable: false, reason: "invalid" }),
    ];
    for (const message of permanent) {
      assert.doesNotMatch(message, /もう一度お試しください/, "再試行できない失敗に再試行を促さない");
    }
    assert.equal(new Set(permanent).size, 4, "理由ごとに文が違う");
  });

  test("再試行では、再試行できる失敗の写真だけを送る", () => {
    const items = [
      item("saved"),
      item("failed"),
      item("failed", { retryable: false }),
      item("failed"),
    ];
    assert.deepEqual(items.map(isPhotoToRegister), [false, true, false, true]);
    assert.equal(getPhotoRegisterButtonLabel(items), "残り2着を登録する");
    assert.equal(canStartPhotoRegistration(items, false), true);
  });

  test("再試行できない失敗だけが残ったら、登録は始められない（無意味な再試行をさせない）", () => {
    const items = [item("saved"), item("failed", { retryable: false })];
    assert.equal(summarizePhotoBatch(items).toRegister, 0);
    assert.equal(canStartPhotoRegistration(items, false), false);
  });
});

describe("登録の取り消し（片付け）", () => {
  test("取り消せるのは、保存に失敗した写真だけ", () => {
    assert.equal(canDiscardPhoto(item("failed")), true);
    assert.equal(canDiscardPhoto(item("failed", { retryable: false })), true);
    for (const status of ["ready", "processing", "saving", "saved"] as const) {
      assert.equal(canDiscardPhoto(item(status)), false, status);
    }
  });

  test("片付けられたときだけ一覧から外す", () => {
    assert.deepEqual(resolveDiscardResult({ ok: true, removedItem: true, removedImage: true }), {
      action: "remove",
    });
  });

  test("保存が完了していたら消さずに登録済みにする", () => {
    const outcome = resolveDiscardResult({ ok: false, reason: "completed" });
    assert.equal(outcome.action, "saved");
  });

  test("編集済み・確認できない・片付けに失敗したときは残して理由を出す", () => {
    for (const reason of ["edited", "unknown", "invalid"] as const) {
      const outcome = resolveDiscardResult({ ok: false, reason });
      assert.equal(outcome.action, "keep", reason);
      assert.ok(outcome.action === "keep" && outcome.message.length > 0, reason);
    }
  });
});

describe("離脱の確認", () => {
  test("登録中・失敗あり・未登録で文が変わり、不完全なデータが残りうることを伝える", () => {
    const registering = getPhotoBatchLeaveMessage({
      items: [item("saved"), item("saving")],
      isRegistering: true,
      otherEntryDirty: false,
    });
    assert.match(registering, /登録の途中/);
    assert.match(registering, /写真のない服が残ることがあります/);
    assert.match(registering, /登録できた服は残ります/);

    const failed = getPhotoBatchLeaveMessage({
      items: [item("saved"), item("failed")],
      isRegistering: false,
      otherEntryDirty: false,
    });
    assert.match(failed, /登録できなかった写真/);
    assert.match(failed, /取り消す/);

    const unsent = getPhotoBatchLeaveMessage({
      items: [item("ready")],
      isRegistering: false,
      otherEntryDirty: false,
    });
    assert.equal(unsent, "このまま移動すると、選んだ写真は登録されません。");
  });

  test("通常登録に入力があれば、下書きの案内を1回の確認に含める", () => {
    const both = getPhotoBatchLeaveMessage({
      items: [item("ready")],
      isRegistering: false,
      otherEntryDirty: true,
    });
    assert.match(both, /選んだ写真は登録されません/);
    assert.match(both, /通常登録で入力中の内容も保存されません/);
    assert.match(both, /下書きとして保存/);

    const onlyNormal = getPhotoBatchLeaveMessage({
      items: [],
      isRegistering: false,
      otherEntryDirty: true,
    });
    assert.match(onlyNormal, /^通常登録で入力中の内容は保存されません/);
    assert.match(PHOTO_ENTRY_PENDING_NOTE, /「写真だけで登録」で選んだ写真/);
  });

  test("確認するのは表示中の画面だけ（重複・見えない確認を出さない）", () => {
    for (const mode of ["normal", "photo"] as const) {
      for (const normalDirty of [false, true]) {
        for (const photoPending of [false, true]) {
          const guards = resolveEntryLeaveGuards({ mode, normalDirty, photoPending });
          assert.ok(!(guards.normal && guards.photo), "同時に2つの画面で確認しない");
          const hidden = mode === "normal" ? guards.photo : guards.normal;
          assert.equal(hidden, false, "隠れている画面は確認しない");
          const visible = mode === "normal" ? guards.normal : guards.photo;
          assert.equal(visible, normalDirty || photoPending, "どちらかに未保存があれば表示中の画面が確認する");
        }
      }
    }
  });
});
