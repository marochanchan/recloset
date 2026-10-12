// 写真からまとめて登録する保存処理と画像変換の制御（lib/photo-batch-registration.ts）の自動テスト。
// Supabase・Storage・AIには接続せず、状態を持つ架空のクライアント（RLS・重複・
// 通信の失敗を再現する）を使う。
//
// 実行方法:
//   node --test scripts/test-photo-batch-registration.mts

import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { beforeEach, describe, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

// "@/lib/xxx"（tsconfigのpaths）を、Node.jsが読めるリポジトリ内の .ts に解決する
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
  MAX_PHOTO_BATCH_SIZE,
  PHOTO_PROCESSING_CONCURRENCY,
  createPhotoItemTarget,
  discardIncompletePhotoItem,
  isPhotoItemTargetForUser,
  preparePhotoBatch,
  registerPhotoBatch,
  registerPhotoItem,
  runWithConcurrency,
} = await import("../lib/photo-batch-registration.ts");
const { ImageProcessingError } = await import("../lib/image-processing.ts");
const { PHOTO_ONLY_CATEGORY, PHOTO_ONLY_TITLE } = await import("../lib/clothing-options.ts");

type PhotoItemTarget = { itemId: string; imagePath: string };

const USER_A = "aaaaaaaa-0000-4000-8000-00000000000a";
const USER_B = "bbbbbbbb-0000-4000-8000-00000000000b";

// ------------------------------------------------------------
// 架空のSupabase
// ------------------------------------------------------------

type Row = Record<string, unknown>;
/**
 * 1回だけ起こす失敗。lost: 書き込んだ後に応答が届かない／network: 書き込まずに通信失敗。
 * pass: その回は失敗させない（2回目以降の呼び出しだけ失敗させたいときに使う）
 */
type Failure = "lost" | "network" | "pass" | { error: Record<string, unknown> };

function createFakeSupabase(currentUser: string) {
  const items = new Map<string, Row>();
  const images: Row[] = [];
  const objects = new Set<string>();
  const failures = new Map<string, Failure[]>();
  const log: string[] = [];

  const takeFailure = (op: string): Exclude<Failure, "pass"> | undefined => {
    const failure = failures.get(op)?.shift();
    return failure === "pass" ? undefined : failure;
  };
  const fail = (op: string, failure: Failure) => {
    failures.set(op, [...(failures.get(op) ?? []), failure]);
  };
  const networkError = () => new TypeError("fetch failed");

  const ownItem = (id: unknown) => {
    const item = items.get(String(id));
    return item && item.user_id === currentUser ? item : undefined;
  };
  // RLS: 本人の行・本人の服の画像だけが見える
  const visibleRows = (table: string): Row[] =>
    table === "clothing_items"
      ? [...items.values()].filter((row) => row.user_id === currentUser)
      : images.filter((row) => ownItem(row.clothing_item_id));

  function insert(table: string, row: Row): { error: Row | null } {
    if (table === "clothing_items") {
      if (row.user_id !== currentUser) return { error: { code: "42501", message: "rls" } };
      if (items.has(String(row.id))) return { error: { code: "23505", message: "duplicate key" } };
      items.set(String(row.id), { ...row });
      return { error: null };
    }
    // clothing_images: 本人の服で、パスが本人のフォルダ（migration 016）
    const item = ownItem(row.clothing_item_id);
    if (!item || !String(row.image_path).startsWith(`${currentUser}/`)) {
      return { error: { code: "42501", message: "rls" } };
    }
    if (images.some((img) => img.clothing_item_id === row.clothing_item_id && img.sort_order === row.sort_order)) {
      return { error: { code: "23505", message: "duplicate key" } };
    }
    images.push({ id: crypto.randomUUID(), ...row });
    return { error: null };
  }

  function from(table: string) {
    let mode: "select" | "insert" | "delete" = "select";
    let insertRow: Row | null = null;
    const filters: [string, unknown][] = [];
    let limitCount: number | null = null;
    let single = false;
    let returning = false;

    const run = async () => {
      const op = `${table}.${mode}`;
      log.push(op);
      const failure = takeFailure(op);
      if (failure === "network") throw networkError();
      if (failure && failure !== "lost") return { data: null, error: failure.error };
      if (mode === "insert") {
        const result = insert(table, insertRow!);
        if (failure === "lost") throw networkError();
        return { data: null, error: result.error };
      }
      let rows = visibleRows(table).filter((row) => filters.every(([col, v]) => row[col] === v));
      if (mode === "delete") {
        for (const row of rows) {
          if (table === "clothing_items") {
            items.delete(String(row.id));
            for (let i = images.length - 1; i >= 0; i--) {
              if (images[i].clothing_item_id === row.id) images.splice(i, 1);
            }
          }
        }
        if (failure === "lost") throw networkError();
        return { data: returning ? rows.map((r) => ({ id: r.id })) : null, error: null };
      }
      if (limitCount !== null) rows = rows.slice(0, limitCount);
      if (failure === "lost") throw networkError();
      if (single) {
        if (rows.length > 1) return { data: null, error: { code: "PGRST116" } };
        return { data: rows[0] ?? null, error: null };
      }
      return { data: rows, error: null };
    };

    const builder = {
      insert(row: Row) {
        mode = "insert";
        insertRow = row;
        return builder;
      },
      delete() {
        mode = "delete";
        return builder;
      },
      select() {
        if (mode === "delete") returning = true;
        return builder;
      },
      eq(column: string, value: unknown) {
        filters.push([column, value]);
        return builder;
      },
      limit(n: number) {
        limitCount = n;
        return builder;
      },
      maybeSingle() {
        single = true;
        return builder;
      },
      then(resolve: (v: unknown) => void, reject: (e: unknown) => void) {
        run().then(resolve, reject);
      },
    };
    return builder;
  }

  const storage = {
    from() {
      return {
        async upload(path: string, _blob: Blob, options: { upsert?: boolean }) {
          log.push("storage.upload");
          assert.equal(options.upsert, false, "上書きアップロードはしない");
          const failure = takeFailure("storage.upload");
          if (failure === "network") throw networkError();
          if (failure && failure !== "lost") return { data: null, error: failure.error };
          if (!path.startsWith(`${currentUser}/`)) {
            return { data: null, error: { statusCode: "403", status: 400, message: "denied" } };
          }
          if (objects.has(path)) {
            return {
              data: null,
              error: { statusCode: "409", status: 400, message: "The resource already exists" },
            };
          }
          objects.add(path);
          if (failure === "lost") throw networkError();
          return { data: { path }, error: null };
        },
        async exists(path: string) {
          log.push("storage.exists");
          const failure = takeFailure("storage.exists");
          if (failure === "network") throw networkError();
          return objects.has(path)
            ? { data: true, error: null }
            : { data: false, error: { status: 404, message: "not found" } };
        },
        async remove(paths: string[]) {
          log.push("storage.remove");
          for (const path of paths) objects.delete(path);
          return { data: [], error: null };
        },
      };
    },
  };

  return { client: { from, storage }, items, images, objects, fail, log };
}

let uuidCounter = 0;
const nextUuid = () => {
  uuidCounter += 1;
  return `00000000-0000-4000-8000-${String(uuidCounter).padStart(12, "0")}`;
};
const targetFor = (userId = USER_A): PhotoItemTarget => createPhotoItemTarget(userId, nextUuid);
const photo = (bytes = 1000) => new Blob([new Uint8Array(bytes)], { type: "image/jpeg" });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asClient = (fake: ReturnType<typeof createFakeSupabase>) => fake.client as any;

beforeEach(() => {
  uuidCounter = 0;
});

// ------------------------------------------------------------
// 写真1枚の保存
// ------------------------------------------------------------

describe("registerPhotoItem（写真1枚の保存）", () => {
  test("服 → 画像のアップロード → 画像の行の順に保存する", async () => {
    const fake = createFakeSupabase(USER_A);
    const target = targetFor();
    const result = await registerPhotoItem(asClient(fake), { userId: USER_A, target, image: photo() });
    assert.deepEqual(result, { ok: true, resumed: false });
    assert.deepEqual(fake.log, ["clothing_items.insert", "storage.upload", "clothing_images.insert"]);
    const item = fake.items.get(target.itemId)!;
    assert.equal(item.user_id, USER_A);
    assert.equal(item.title, PHOTO_ONLY_TITLE);
    assert.equal(item.category, PHOTO_ONLY_CATEGORY);
    assert.deepEqual(item.seasons, []);
    assert.ok(fake.objects.has(target.imagePath));
    assert.equal(fake.images.length, 1);
    assert.equal(fake.images[0].clothing_item_id, target.itemId);
    assert.equal(fake.images[0].image_path, target.imagePath);
    assert.equal(fake.images[0].sort_order, 0);
  });

  test("保存済みの写真をもう一度送っても、服・画像は1つのまま", async () => {
    const fake = createFakeSupabase(USER_A);
    const target = targetFor();
    await registerPhotoItem(asClient(fake), { userId: USER_A, target, image: photo() });
    const again = await registerPhotoItem(asClient(fake), { userId: USER_A, target, image: photo() });
    assert.deepEqual(again, { ok: true, resumed: true });
    assert.equal(fake.items.size, 1);
    assert.equal(fake.images.length, 1);
    assert.equal(fake.objects.size, 1);
  });

  for (const op of ["clothing_items.insert", "storage.upload", "clothing_images.insert"]) {
    test(`保存できたのに応答が届かなかった場合（${op}）は、確かめて続ける`, async () => {
      const fake = createFakeSupabase(USER_A);
      fake.fail(op, "lost");
      const target = targetFor();
      const result = await registerPhotoItem(asClient(fake), { userId: USER_A, target, image: photo() });
      assert.deepEqual(result, { ok: true, resumed: true });
      assert.equal(fake.items.size, 1);
      assert.equal(fake.images.length, 1);
      assert.equal(fake.objects.size, 1);
    });
  }

  test("通信の失敗で保存されていなければ、再試行できる失敗として返す", async () => {
    const cases: [string, "item" | "upload" | "image"][] = [
      ["clothing_items.insert", "item"],
      ["storage.upload", "upload"],
      ["clothing_images.insert", "image"],
    ];
    for (const [op, stage] of cases) {
      const fake = createFakeSupabase(USER_A);
      fake.fail(op, "network");
      const target = targetFor();
      const result = await registerPhotoItem(asClient(fake), { userId: USER_A, target, image: photo() });
      assert.equal(result.ok, false, op);
      if (result.ok) return;
      assert.equal(result.stage, stage, op);
      assert.equal(result.retryable, true, op);
      assert.equal(result.reason, "unknown", op);
      // 同じ target で再試行すると完了し、重複しない
      const retried = await registerPhotoItem(asClient(fake), { userId: USER_A, target, image: photo() });
      assert.equal(retried.ok, true, `${op} retry`);
      assert.equal(fake.items.size, 1, op);
      assert.equal(fake.images.length, 1, op);
      assert.equal(fake.objects.size, 1, op);
    }
  });

  test("結果を確かめる問い合わせも失敗したら、決めつけずに再試行できる失敗にする", async () => {
    const fake = createFakeSupabase(USER_A);
    fake.fail("clothing_items.insert", "lost");
    fake.fail("clothing_items.select", "network");
    const target = targetFor();
    const result = await registerPhotoItem(asClient(fake), { userId: USER_A, target, image: photo() });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.deepEqual([result.stage, result.retryable, result.reason], ["item", true, "unknown"]);
    assert.equal(fake.objects.size, 0, "確認できないうちは次の段階に進まない");
    const retried = await registerPhotoItem(asClient(fake), { userId: USER_A, target, image: photo() });
    assert.deepEqual(retried, { ok: true, resumed: true });
    assert.equal(fake.items.size, 1);
  });

  test("アップロードの結果を確かめられない場合も、再試行できる失敗にする", async () => {
    const fake = createFakeSupabase(USER_A);
    fake.fail("storage.upload", "network");
    fake.fail("storage.exists", "network");
    const target = targetFor();
    const result = await registerPhotoItem(asClient(fake), { userId: USER_A, target, image: photo() });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.deepEqual([result.stage, result.retryable], ["upload", true]);
    assert.equal(fake.images.length, 0);
  });

  test("同じIDの服が他人の行なら、使わずに止める（23505でも成功扱いしない）", async () => {
    const fake = createFakeSupabase(USER_A);
    const target = targetFor();
    fake.items.set(target.itemId, { id: target.itemId, user_id: USER_B, title: "B", category: "tops" });
    const result = await registerPhotoItem(asClient(fake), { userId: USER_A, target, image: photo() });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.deepEqual([result.stage, result.retryable, result.reason], ["item", false, "conflict"]);
    assert.equal(fake.objects.size, 0);
    assert.equal(fake.items.get(target.itemId)!.user_id, USER_B, "他人の行は変えない");
  });

  test("服に別の画像が既に紐づいていたら、何も消さずに止める", async () => {
    const fake = createFakeSupabase(USER_A);
    const target = targetFor();
    const otherPath = `${USER_A}/${target.itemId}/${nextUuid()}.jpg`;
    fake.items.set(target.itemId, { id: target.itemId, user_id: USER_A, title: PHOTO_ONLY_TITLE, category: "other" });
    fake.images.push({ id: "x", clothing_item_id: target.itemId, image_path: otherPath, sort_order: 0 });
    fake.objects.add(otherPath);
    const result = await registerPhotoItem(asClient(fake), { userId: USER_A, target, image: photo() });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.deepEqual([result.stage, result.retryable, result.reason], ["image", false, "conflict"]);
    assert.equal(fake.images.length, 1);
    assert.ok(fake.objects.has(otherPath));
    assert.ok(fake.items.has(target.itemId));
  });

  test("RLS・権限で拒否された場合は、再試行しても成功しない失敗として返す", async () => {
    const fake = createFakeSupabase(USER_A);
    fake.fail("clothing_images.insert", { error: { code: "42501", message: "rls" } });
    const result = await registerPhotoItem(asClient(fake), {
      userId: USER_A,
      target: targetFor(),
      image: photo(),
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.deepEqual([result.stage, result.retryable, result.reason], ["image", false, "denied"]);
  });

  test("他人のフォルダ・形の違うパスや、空・10MB超の画像は送らない", async () => {
    const fake = createFakeSupabase(USER_A);
    const ownTarget = targetFor();
    const bad: PhotoItemTarget[] = [
      targetFor(USER_B),
      { itemId: ownTarget.itemId, imagePath: `${USER_A}/${nextUuid()}/${nextUuid()}.jpg` },
      { itemId: ownTarget.itemId, imagePath: `${USER_A}/${ownTarget.itemId}/../x.jpg` },
      { itemId: "not-a-uuid", imagePath: `${USER_A}/not-a-uuid/${nextUuid()}.jpg` },
    ];
    for (const target of bad) {
      assert.equal(isPhotoItemTargetForUser(target, USER_A), false);
      const result = await registerPhotoItem(asClient(fake), { userId: USER_A, target, image: photo() });
      assert.equal(result.ok, false);
    }
    for (const image of [photo(0), photo(10 * 1024 * 1024 + 1)]) {
      const result = await registerPhotoItem(asClient(fake), { userId: USER_A, target: ownTarget, image });
      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.equal(result.retryable, false);
    }
    assert.deepEqual(fake.log, [], "DB・Storageに何も送っていない");
  });
});

// ------------------------------------------------------------
// 複数の写真の保存
// ------------------------------------------------------------

describe("registerPhotoBatch（複数の写真を1着ずつ保存）", () => {
  test("1着ずつ順に保存する（前の写真が終わってから次へ）", async () => {
    const fake = createFakeSupabase(USER_A);
    const entries = [1, 2, 3].map(() => ({ target: targetFor(), image: photo(), done: false }));
    const settled: number[] = [];
    const results = await registerPhotoBatch(asClient(fake), {
      userId: USER_A,
      entries,
      onSettled: (index) => settled.push(index),
    });
    assert.ok(results.every((r) => r?.ok));
    assert.deepEqual(settled, [0, 1, 2]);
    assert.deepEqual(
      fake.log,
      [0, 1, 2].flatMap(() => ["clothing_items.insert", "storage.upload", "clothing_images.insert"]),
    );
    assert.equal(fake.items.size, 3);
    assert.equal(new Set(fake.images.map((img) => img.clothing_item_id)).size, 3, "それぞれ独立した服");
  });

  test("途中の1着が失敗しても、他の写真は保存し、他の写真のデータを消さない", async () => {
    const fake = createFakeSupabase(USER_A);
    const entries = [1, 2, 3].map(() => ({ target: targetFor(), image: photo(), done: false }));
    // 1枚目: アップロードできたが応答が届かない（確認して成功）
    // 2枚目: アップロードが通信で失敗し、その確認も失敗する
    fake.fail("storage.upload", "lost");
    fake.fail("storage.upload", "network");
    fake.fail("storage.exists", "pass");
    fake.fail("storage.exists", "network");
    const results = await registerPhotoBatch(asClient(fake), { userId: USER_A, entries });
    // 1枚目は応答が届かなかったが確認できて成功、2枚目は失敗、3枚目は成功
    assert.equal(results[0]?.ok, true);
    assert.equal(results[1]?.ok, false);
    assert.equal(results[2]?.ok, true);
    assert.ok(fake.objects.has(entries[0].target.imagePath));
    assert.ok(fake.objects.has(entries[2].target.imagePath));
    assert.equal(fake.images.length, 2);
    assert.ok(!fake.log.includes("storage.remove"), "何も削除していない");
    assert.ok(!fake.log.includes("clothing_items.delete"), "何も削除していない");
  });

  test("再試行では失敗した写真だけを送り、保存済みの写真は送らない（二重登録しない）", async () => {
    const fake = createFakeSupabase(USER_A);
    const entries = [1, 2, 3].map(() => ({ target: targetFor(), image: photo(), done: false }));
    fake.fail("clothing_images.insert", "network");
    const first = await registerPhotoBatch(asClient(fake), { userId: USER_A, entries });
    assert.deepEqual(first.map((r) => r?.ok), [false, true, true]);
    assert.equal(fake.items.size, 3, "1枚目の服の行は残っている（画像の紐づけだけ未完了）");

    const retryEntries = entries.map((entry, i) => ({ ...entry, done: first[i]?.ok === true }));
    fake.log.length = 0;
    const second = await registerPhotoBatch(asClient(fake), { userId: USER_A, entries: retryEntries });
    assert.equal(second[0]?.ok, true);
    assert.equal(second[1], null, "保存済みは送らない");
    assert.equal(second[2], null, "保存済みは送らない");
    assert.equal(fake.log.filter((op) => op === "clothing_items.insert").length, 1);
    assert.equal(fake.items.size, 3);
    assert.equal(fake.images.length, 3);
    assert.equal(fake.objects.size, 3);
  });

  test("最大20枚。21枚は受け付けない", async () => {
    const fake = createFakeSupabase(USER_A);
    assert.equal(MAX_PHOTO_BATCH_SIZE, 20);
    const make = (n: number) =>
      Array.from({ length: n }, () => ({ target: targetFor(), image: photo(), done: false }));
    await assert.rejects(() => registerPhotoBatch(asClient(fake), { userId: USER_A, entries: make(21) }));
    assert.deepEqual(fake.log, []);
    const results = await registerPhotoBatch(asClient(fake), { userId: USER_A, entries: make(20) });
    assert.equal(results.filter((r) => r?.ok).length, 20);
    assert.equal(fake.items.size, 20);
  });
});

// ------------------------------------------------------------
// 登録をやめた写真の片付け
// ------------------------------------------------------------

describe("discardIncompletePhotoItem（登録をやめた写真の片付け）", () => {
  test("画像の紐づいていない服と、参照されていない画像ファイルを片付ける", async () => {
    const fake = createFakeSupabase(USER_A);
    const target = targetFor();
    fake.fail("clothing_images.insert", { error: { code: "42501" } });
    await registerPhotoItem(asClient(fake), { userId: USER_A, target, image: photo() });
    assert.ok(fake.items.has(target.itemId));
    assert.ok(fake.objects.has(target.imagePath));
    const result = await discardIncompletePhotoItem(asClient(fake), { userId: USER_A, target });
    assert.deepEqual(result, { ok: true, removedItem: true, removedImage: true });
    assert.equal(fake.items.size, 0);
    assert.equal(fake.objects.size, 0);
  });

  test("保存が完了している（画像の行がある）服は消さない", async () => {
    const fake = createFakeSupabase(USER_A);
    const target = targetFor();
    await registerPhotoItem(asClient(fake), { userId: USER_A, target, image: photo() });
    const result = await discardIncompletePhotoItem(asClient(fake), { userId: USER_A, target });
    assert.deepEqual(result, { ok: false, reason: "completed" });
    assert.equal(fake.items.size, 1);
    assert.equal(fake.images.length, 1);
    assert.equal(fake.objects.size, 1);
  });

  test("編集済み（タイトルが変わった）服は消さない", async () => {
    const fake = createFakeSupabase(USER_A);
    const target = targetFor();
    fake.items.set(target.itemId, { id: target.itemId, user_id: USER_A, title: "白いシャツ", category: "other" });
    const result = await discardIncompletePhotoItem(asClient(fake), { userId: USER_A, target });
    assert.deepEqual(result, { ok: false, reason: "edited" });
    assert.ok(fake.items.has(target.itemId));
  });

  test("確認の問い合わせに失敗したら、何も消さない", async () => {
    const fake = createFakeSupabase(USER_A);
    const target = targetFor();
    fake.items.set(target.itemId, { id: target.itemId, user_id: USER_A, title: PHOTO_ONLY_TITLE, category: "other" });
    fake.fail("clothing_images.select", "network");
    const result = await discardIncompletePhotoItem(asClient(fake), { userId: USER_A, target });
    assert.equal(result.ok, false);
    assert.ok(fake.items.has(target.itemId));
  });

  test("他人のパスは扱わない", async () => {
    const fake = createFakeSupabase(USER_A);
    const result = await discardIncompletePhotoItem(asClient(fake), {
      userId: USER_A,
      target: targetFor(USER_B),
    });
    assert.deepEqual(result, { ok: false, reason: "invalid" });
    assert.deepEqual(fake.log, []);
  });
});

// ------------------------------------------------------------
// 画像変換の制御
// ------------------------------------------------------------

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const fakeProcessed = (bytes = 100) => ({
  blob: new Blob([new Uint8Array(bytes)], { type: "image/jpeg" }),
  width: 10,
  height: 10,
});

describe("画像変換の制御", () => {
  test("同時に変換するのは最大2枚。結果は選んだ順", async () => {
    assert.equal(PHOTO_PROCESSING_CONCURRENCY, 2);
    const files = Array.from({ length: 7 }, (_, i) => new File([`f${i}`], `p${i}.jpg`));
    let active = 0;
    let maxActive = 0;
    const settledOrder: number[] = [];
    const results = await preparePhotoBatch(files, {
      process: async (file) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await sleep(file.name === "p0.jpg" ? 30 : 5);
        active -= 1;
        return fakeProcessed();
      },
      onSettled: (index) => settledOrder.push(index),
    });
    assert.equal(maxActive, 2);
    assert.equal(results.length, 7);
    assert.ok(results.every((r) => r.ok));
    assert.equal(settledOrder.length, 7);
    assert.notEqual(settledOrder[0], 0, "時間のかかる1枚目を待たずに次を変換する");
  });

  test("変換に失敗した写真だけ失敗にし、他の写真は続けて変換する（HEIC等の既存の扱いを保つ）", async () => {
    const files = ["a.jpg", "b.heic", "c.jpg", "d.jpg"].map((name) => new File(["x"], name));
    const results = await preparePhotoBatch(files, {
      process: async (file) => {
        if (file.name === "b.heic") throw new ImageProcessingError("この画像は読み込めませんでした");
        if (file.name === "d.jpg") throw new Error("unexpected");
        return fakeProcessed();
      },
    });
    assert.deepEqual(results.map((r) => r.ok), [true, false, true, false]);
    assert.deepEqual(
      results.filter((r) => !r.ok).map((r) => (r.ok ? "" : r.message)),
      ["b.heic: この画像は読み込めませんでした", "d.jpg: 画像を処理できませんでした"],
    );
  });

  test("変換後に10MBを超える画像は失敗にする", async () => {
    const results = await preparePhotoBatch([new File(["x"], "big.jpg")], {
      process: async () => fakeProcessed(10 * 1024 * 1024 + 1),
    });
    assert.equal(results[0].ok, false);
  });

  test("最大20枚。21枚は変換を始めない", async () => {
    let calls = 0;
    const make = (n: number) => Array.from({ length: n }, (_, i) => new File(["x"], `${i}.jpg`));
    await assert.rejects(() =>
      preparePhotoBatch(make(21), {
        process: async () => {
          calls += 1;
          return fakeProcessed();
        },
      }),
    );
    assert.equal(calls, 0);
    const results = await preparePhotoBatch(make(20), { process: async () => fakeProcessed() });
    assert.equal(results.length, 20);
  });

  test("runWithConcurrency: 上限を守り、失敗しても他を止めない", async () => {
    let active = 0;
    let maxActive = 0;
    const results = await runWithConcurrency([1, 2, 3, 4, 5], 2, async (n) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await sleep(3);
      active -= 1;
      if (n === 3) throw new Error("boom");
      return n * 10;
    });
    assert.equal(maxActive, 2);
    assert.deepEqual(
      results.map((r) => (r.status === "fulfilled" ? r.value : "x")),
      [10, 20, "x", 40, 50],
    );
    assert.deepEqual(await runWithConcurrency([], 2, async () => 1), []);
  });
});
