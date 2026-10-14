// Re:Story（lib/re-story.ts・lib/re-story-copy.ts・lib/re-story-query.ts）の自動テスト。
// DB・ネットワーク・ブラウザには接続しない（Supabaseクライアントはモックを使う）。
//
// 実行方法:
//   node --test scripts/test-re-story.mts

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
  buildStoryTimeline,
  getJstMonthKey,
  getJstMonthRangeUtc,
  isMonthBeforeTracking,
  isMonthKey,
  resolveMonthEventsLimit,
  resolveStoryMonth,
  shiftMonthKey,
  summarizeStoryMonth,
} = await import("../lib/re-story.ts");
const {
  formatStoryDate,
  getStoryActionSentence,
  getStoryItemsDescription,
  getStoryMonthMessage,
  RE_STORY_EMPTY_MONTH_MESSAGE,
} = await import("../lib/re-story-copy.ts");
const { fetchStoryPage, toStoryEvents } = await import("../lib/re-story-query.ts");

const PHOTO_ONLY = "写真から登録した服";

type Kind = "register" | "wear" | "review" | "organize" | "circulate";
type Action =
  | "item_registered"
  | "wear_logged"
  | "ai_diagnosis"
  | "swipe_review"
  | "category_classified"
  | "seasons_classified"
  | "status_candidate"
  | "status_letting_go"
  | "status_sold";

let seq = 0;
const ev = (
  kind: Kind,
  action: Action,
  occurredAt: string,
  item: { id: string | null; title?: string | null } = { id: "item-a", title: "ニット" },
  revokedAt: string | null = null,
) => ({
  id: `ev-${String(++seq).padStart(4, "0")}`,
  kind,
  action,
  clothingItemId: item.id,
  itemTitle: item.id === null ? null : (item.title ?? null),
  occurredAt,
  revokedAt,
});

describe("月（日本時間）", () => {
  test("日本時間の月の境界（UTC 14:59 は前の月、15:00 は次の月）", () => {
    assert.equal(getJstMonthKey(new Date("2026-09-30T14:59:59.999Z")), "2026-09");
    assert.equal(getJstMonthKey(new Date("2026-09-30T15:00:00Z")), "2026-10");
  });

  test("月の範囲（日本時間の1日0:00〜翌月1日0:00）", () => {
    const range = getJstMonthRangeUtc("2026-10");
    assert.equal(range.startUtc.toISOString(), "2026-09-30T15:00:00.000Z");
    assert.equal(range.endUtc.toISOString(), "2026-10-31T15:00:00.000Z");
    const december = getJstMonthRangeUtc("2026-12");
    assert.equal(december.endUtc.toISOString(), "2026-12-31T15:00:00.000Z");
  });

  test("月の移動（年をまたぐ）", () => {
    assert.equal(shiftMonthKey("2026-01", -1), "2025-12");
    assert.equal(shiftMonthKey("2026-12", 1), "2027-01");
  });

  test("month の検証", () => {
    assert.equal(isMonthKey("2026-10"), true);
    for (const value of ["2026-13", "2026-00", "2026-1", "26-10", "abc", "", undefined, 202610]) {
      assert.equal(isMonthKey(value), false, String(value));
    }
  });
});

describe("resolveStoryMonth（月の切り替え）", () => {
  // 2026-10-15 12:00 JST
  const now = new Date("2026-10-15T03:00:00Z");

  test("不正な値・未指定・未来の月は今月", () => {
    for (const requested of [undefined, "abc", "2026-13", "2027-01", "2026-11"]) {
      assert.equal(
        resolveStoryMonth({ requested, now, firstMonthKey: "2026-01" }).monthKey,
        "2026-10",
        String(requested),
      );
    }
  });

  test("最初の行動の月より前は、最初の行動の月", () => {
    const nav = resolveStoryMonth({ requested: "2025-05", now, firstMonthKey: "2026-01" });
    assert.deepEqual(nav, { monthKey: "2026-01", prevMonthKey: null, nextMonthKey: "2026-02" });
  });

  test("前後の月（今月より先には進めない）", () => {
    assert.deepEqual(resolveStoryMonth({ requested: "2026-10", now, firstMonthKey: "2026-01" }), {
      monthKey: "2026-10",
      prevMonthKey: "2026-09",
      nextMonthKey: null,
    });
    assert.deepEqual(resolveStoryMonth({ requested: "2026-05", now, firstMonthKey: "2026-01" }), {
      monthKey: "2026-05",
      prevMonthKey: "2026-04",
      nextMonthKey: "2026-06",
    });
  });

  test("行動がない人は今月だけ（前後に移動しない）", () => {
    assert.deepEqual(resolveStoryMonth({ requested: "2026-03", now, firstMonthKey: null }), {
      monthKey: "2026-10",
      prevMonthKey: null,
      nextMonthKey: null,
    });
  });
});

describe("summarizeStoryMonth（集計）", () => {
  test("空の月", () => {
    const summary = summarizeStoryMonth([]);
    assert.equal(summary.activeDays, 0);
    assert.equal(summary.totalEvents, 0);
    assert.equal(getStoryMonthMessage(summary), RE_STORY_EMPTY_MONTH_MESSAGE);
  });

  test("活動日数: 種類をまたいでも同じ日は1日、同じ種類を何回しても1日", () => {
    const summary = summarizeStoryMonth([
      ev("wear", "wear_logged", "2026-10-14T01:00:00Z"),
      ev("wear", "wear_logged", "2026-10-14T05:00:00Z"),
      ev("register", "item_registered", "2026-10-14T06:00:00Z", { id: "b", title: "シャツ" }),
      ev("wear", "wear_logged", "2026-10-16T01:00:00Z"),
    ]);
    assert.equal(summary.activeDays, 2);
    assert.equal(summary.daysByKind.wear, 2);
    assert.equal(summary.daysByKind.register, 1);
    // 回数と日数を分ける
    assert.equal(summary.wearCount, 3);
    assert.equal(summary.registeredItemCount, 1);
  });

  test("日付は日本時間で分ける（UTC 14:59 と 15:00 は別の日）", () => {
    const summary = summarizeStoryMonth([
      ev("wear", "wear_logged", "2026-10-14T14:59:00Z"),
      ev("wear", "wear_logged", "2026-10-14T15:00:00Z"),
    ]);
    assert.equal(summary.activeDays, 2);
  });

  test("見直した着数: 同じ日・同じ服は1着、別の日は別に数える（AI診断とスワイプも合わせる）", () => {
    const summary = summarizeStoryMonth([
      ev("review", "ai_diagnosis", "2026-10-14T01:00:00Z", { id: "a", title: "ニット" }),
      ev("review", "swipe_review", "2026-10-14T02:00:00Z", { id: "a", title: "ニット" }),
      ev("review", "swipe_review", "2026-10-14T02:00:00Z", { id: "b", title: "シャツ" }),
      ev("review", "swipe_review", "2026-10-15T02:00:00Z", { id: "a", title: "ニット" }),
    ]);
    assert.equal(summary.reviewedItemCount, 3);
    assert.equal(summary.daysByKind.review, 2);
  });

  test("取り消し済みの行動は集計しない", () => {
    const summary = summarizeStoryMonth([
      ev("review", "swipe_review", "2026-10-14T02:00:00Z", { id: "a" }, "2026-10-14T02:01:00Z"),
    ]);
    assert.equal(summary.activeDays, 0);
    assert.equal(summary.reviewedItemCount, 0);
  });

  test("削除した服の行動も数える（同じ服か分からないため行動ごとに1着）", () => {
    const summary = summarizeStoryMonth([
      ev("review", "swipe_review", "2026-10-14T02:00:00Z", { id: null }),
      ev("review", "swipe_review", "2026-10-14T03:00:00Z", { id: null }),
      ev("organize", "status_candidate", "2026-10-14T03:00:00Z", { id: null }),
      ev("circulate", "status_sold", "2026-10-15T03:00:00Z", { id: null }),
    ]);
    assert.equal(summary.reviewedItemCount, 2);
    assert.equal(summary.organizeCount, 1);
    assert.equal(summary.circulateCount, 1);
    assert.equal(summary.activeDays, 2);
  });
});

describe("buildStoryTimeline（日付 × 具体的な行動）", () => {
  test("一括登録は1行にまとめ、名前・写真だけ登録・削除した服を分ける", () => {
    const days = buildStoryTimeline(
      [
        ev("register", "item_registered", "2026-10-14T01:00:00Z", { id: "a", title: "ニット" }),
        ev("register", "item_registered", "2026-10-14T01:00:01Z", { id: "b", title: "シャツ" }),
        ev("register", "item_registered", "2026-10-14T01:00:02Z", { id: "c", title: "パンツ" }),
        ev("register", "item_registered", "2026-10-14T01:00:03Z", { id: "d", title: PHOTO_ONLY }),
        ev("register", "item_registered", "2026-10-14T01:00:04Z", { id: "e", title: PHOTO_ONLY }),
        ev("register", "item_registered", "2026-10-14T01:00:05Z", { id: null }),
      ],
      PHOTO_ONLY,
    );
    assert.equal(days.length, 1);
    const [group] = days[0].groups;
    assert.equal(group.itemCount, 6);
    assert.equal(group.photoOnlyItemCount, 2);
    assert.equal(group.deletedItemCount, 1);
    assert.deepEqual(group.namedItems.map((item) => item.title), ["パンツ", "シャツ", "ニット"]);
    assert.equal(getStoryActionSentence(group), "服を6着登録しました");
    assert.equal(
      getStoryItemsDescription(group, PHOTO_ONLY),
      "パンツ、シャツ ほか1着・写真から登録した服2着・削除した服",
    );
  });

  test("日付は新しい順、1日の中は最後にした行動が新しい順。取り消し済みは出さない", () => {
    const days = buildStoryTimeline(
      [
        ev("wear", "wear_logged", "2026-10-13T01:00:00Z"),
        ev("register", "item_registered", "2026-10-14T01:00:00Z"),
        ev("wear", "wear_logged", "2026-10-14T05:00:00Z"),
        ev("wear", "wear_logged", "2026-10-14T06:00:00Z"),
        ev("review", "swipe_review", "2026-10-14T07:00:00Z", { id: "a" }, "2026-10-14T07:01:00Z"),
      ],
      PHOTO_ONLY,
    );
    assert.deepEqual(days.map((day) => day.dateKey), ["2026-10-14", "2026-10-13"]);
    assert.deepEqual(
      days[0].groups.map((group) => group.action),
      ["wear_logged", "item_registered"],
    );
    assert.equal(days[0].groups[0].eventCount, 2);
    assert.equal(getStoryActionSentence(days[0].groups[0]), "着た服を2回記録しました");
    assert.equal(getStoryItemsDescription(days[0].groups[0], PHOTO_ONLY), "ニット");
  });

  test("日本時間の日付で分ける", () => {
    const days = buildStoryTimeline(
      [
        ev("wear", "wear_logged", "2026-10-13T14:59:00Z"),
        ev("wear", "wear_logged", "2026-10-13T15:00:00Z"),
      ],
      PHOTO_ONLY,
    );
    assert.deepEqual(days.map((day) => day.dateKey), ["2026-10-14", "2026-10-13"]);
  });

  test("写真だけ登録した服1着・削除した服1着の表記", () => {
    const [day] = buildStoryTimeline(
      [
        ev("organize", "category_classified", "2026-10-14T01:00:00Z", { id: "d", title: PHOTO_ONLY }),
        ev("organize", "category_classified", "2026-10-14T01:00:01Z", { id: null }),
      ],
      PHOTO_ONLY,
    );
    assert.equal(
      getStoryItemsDescription(day.groups[0], PHOTO_ONLY),
      "写真から登録した服・削除した服",
    );
    assert.equal(getStoryActionSentence(day.groups[0]), "2着のカテゴリを仕分けました");
  });
});

describe("文言", () => {
  test("月のひとこと: いちばん多い種類（同じ日数なら手放しを先にしない）", () => {
    const summary = summarizeStoryMonth([
      ev("circulate", "status_sold", "2026-10-14T01:00:00Z"),
      ev("wear", "wear_logged", "2026-10-15T01:00:00Z"),
    ]);
    assert.equal(
      getStoryMonthMessage(summary),
      "この月は2日、服と向き合いました。着た日の記録が、いちばん多い月でした。",
    );
  });

  test("月のひとこと: 3種類以上なら「いろいろな形で」", () => {
    const summary = summarizeStoryMonth([
      ev("wear", "wear_logged", "2026-10-14T01:00:00Z"),
      ev("review", "swipe_review", "2026-10-14T01:00:00Z"),
      ev("register", "item_registered", "2026-10-14T01:00:00Z"),
    ]);
    assert.match(getStoryMonthMessage(summary), /いろいろな形で/);
  });

  test("日付の見出し（曜日）", () => {
    assert.equal(formatStoryDate("2026-10-14"), "10月14日（水）");
  });
});

describe("1000件の上限", () => {
  test("1001件目の有無と、正確な件数で判定する", () => {
    assert.equal(resolveMonthEventsLimit({ rowCount: 0, exactCount: null }), "ok");
    assert.equal(resolveMonthEventsLimit({ rowCount: 999, exactCount: null }), "ok");
    assert.equal(resolveMonthEventsLimit({ rowCount: 1001, exactCount: null }), "over_limit");
    assert.equal(resolveMonthEventsLimit({ rowCount: 1000, exactCount: 1000 }), "ok");
    assert.equal(resolveMonthEventsLimit({ rowCount: 1000, exactCount: 1001 }), "over_limit");
    // 件数が分からなければ、数え漏れを避けて超過とみなす
    assert.equal(resolveMonthEventsLimit({ rowCount: 1000, exactCount: null }), "over_limit");
  });
});

describe("019 適用前の注記", () => {
  const since = "2026-10-14T13:00:00Z"; // 2026-10-14 22:00 JST に適用

  test("適用より前に始まる月だけ注記する（適用した月も含む）", () => {
    assert.equal(isMonthBeforeTracking("2026-09", since), true);
    assert.equal(isMonthBeforeTracking("2026-10", since), true);
    assert.equal(isMonthBeforeTracking("2026-11", since), false);
  });

  test("初期作成の行がない人（019 の後に始めた人）は注記しない", () => {
    assert.equal(isMonthBeforeTracking("2026-09", null), false);
  });
});

test("toStoryEvents: 服の名前（オブジェクト・配列・削除済み）と、知らない種類の除外", () => {
  const events = toStoryEvents([
    { id: "1", kind: "wear", action: "wear_logged", clothing_item_id: "a", occurred_at: "2026-10-14T01:00:00Z", revoked_at: null, clothing_items: { title: "ニット" } },
    { id: "2", kind: "wear", action: "wear_logged", clothing_item_id: "b", occurred_at: "2026-10-14T01:00:00Z", revoked_at: null, clothing_items: [{ title: "シャツ" }] },
    { id: "3", kind: "wear", action: "wear_logged", clothing_item_id: null, occurred_at: "2026-10-14T01:00:00Z", revoked_at: null, clothing_items: null },
    { id: "4", kind: "unknown", action: "wear_logged", clothing_item_id: "a", occurred_at: "2026-10-14T01:00:00Z", revoked_at: null, clothing_items: null },
  ]);
  assert.deepEqual(
    events.map((event) => [event.id, event.itemTitle]),
    [
      ["1", "ニット"],
      ["2", "シャツ"],
      ["3", null],
    ],
  );
});

// ------------------------------------------------------------
// fetchStoryPage（Supabaseのモック）
// ------------------------------------------------------------

type QueryLog = { table: string; ops: string[] };

function createSupabaseMock({
  first = null,
  tracking = null,
  monthRows = [],
  count = null,
  failMonth = false,
}: {
  first?: { occurred_at: string } | null;
  tracking?: { created_at: string } | null;
  monthRows?: unknown[];
  count?: number | null;
  failMonth?: boolean;
}) {
  const logs: QueryLog[] = [];
  const client = {
    from(table: string) {
      const log: QueryLog = { table, ops: [] };
      logs.push(log);
      let kind: "first" | "tracking" | "month" | "count" = "month";
      const builder = {
        select(columns: string, options?: { count?: string; head?: boolean }) {
          log.ops.push(`select:${columns}`);
          if (options?.head) kind = "count";
          else if (columns === "occurred_at") kind = "first";
          else if (columns === "created_at") kind = "tracking";
          return builder;
        },
        eq: (column: string, value: string) => (log.ops.push(`eq:${column}:${value}`), builder),
        is: (column: string, value: null) => (log.ops.push(`is:${column}:${value}`), builder),
        gte: (column: string, value: string) => (log.ops.push(`gte:${column}:${value}`), builder),
        lt: (column: string, value: string) => (log.ops.push(`lt:${column}:${value}`), builder),
        order: (column: string) => (log.ops.push(`order:${column}`), builder),
        limit: (n: number) => (log.ops.push(`limit:${n}`), builder),
        maybeSingle: () =>
          Promise.resolve({ data: kind === "first" ? first : tracking, error: null }),
        then(resolve: (value: unknown) => unknown) {
          if (kind === "count") return resolve({ count, error: null });
          if (failMonth) return resolve({ data: null, error: { message: "boom" } });
          return resolve({ data: monthRows, error: null });
        },
      };
      return builder;
    },
  };
  return { client, logs };
}

const row = (i: number) => ({
  id: `r-${i}`,
  kind: "wear",
  action: "wear_logged",
  clothing_item_id: "a",
  occurred_at: "2026-10-14T01:00:00Z",
  revoked_at: null,
  clothing_items: { title: "ニット" },
});

const quiet = async <T,>(fn: () => Promise<T>): Promise<T> => {
  const original = console.error;
  console.error = () => {};
  try {
    return await fn();
  } finally {
    console.error = original;
  }
};

describe("fetchStoryPage", () => {
  const now = new Date("2026-10-15T03:00:00Z");
  const options = { userId: "user-1", requestedMonth: "2026-10", photoOnlyTitle: PHOTO_ONLY, now };

  test("本人・取り消し以外・その月の範囲だけを、1001件目まで要求する", async () => {
    const { client, logs } = createSupabaseMock({
      first: { occurred_at: "2026-09-01T00:00:00Z" },
      monthRows: [row(1)],
    });
    // @ts-expect-error テスト用のモック
    const result = await fetchStoryPage(client, options);
    assert.equal(result.ok, true);
    assert.ok(result.ok && result.data.hasAnyEvents);
    assert.equal(result.ok && result.data.summary.wearCount, 1);
    assert.deepEqual(result.ok && result.data.nav, {
      monthKey: "2026-10",
      prevMonthKey: "2026-09",
      nextMonthKey: null,
    });
    const month = logs.find((log) => log.ops.some((op) => op.startsWith("gte:")));
    assert.ok(month?.ops.includes("eq:user_id:user-1"));
    assert.ok(month?.ops.includes("is:revoked_at:null"));
    assert.ok(month?.ops.includes("gte:occurred_at:2026-09-30T15:00:00.000Z"));
    assert.ok(month?.ops.includes("lt:occurred_at:2026-10-31T15:00:00.000Z"));
    assert.ok(month?.ops.includes("limit:1001"));
    // 1000件に届かなければ、件数の確認はしない
    assert.equal(logs.filter((log) => log.ops.includes("select:id")).length, 0);
  });

  test("行動が1件もない人", async () => {
    const { client } = createSupabaseMock({});
    // @ts-expect-error テスト用のモック
    const result = await fetchStoryPage(client, options);
    assert.ok(result.ok && !result.data.hasAnyEvents);
    assert.equal(result.ok && result.data.timeline.length, 0);
  });

  test("1001件返れば上限超過（0件として表示しない）", async () => {
    const { client } = createSupabaseMock({
      first: { occurred_at: "2026-09-01T00:00:00Z" },
      monthRows: Array.from({ length: 1001 }, (_, i) => row(i)),
    });
    // @ts-expect-error テスト用のモック
    const result = await fetchStoryPage(client, options);
    assert.deepEqual(result.ok, false);
    assert.equal(!result.ok && result.reason, "over_limit");
  });

  test("1000件で切られたときは正確な件数で判定する", async () => {
    const rows = Array.from({ length: 1000 }, (_, i) => row(i));
    const exact = createSupabaseMock({
      first: { occurred_at: "2026-09-01T00:00:00Z" },
      monthRows: rows,
      count: 1000,
    });
    // @ts-expect-error テスト用のモック
    assert.equal((await fetchStoryPage(exact.client, options)).ok, true);

    const over = createSupabaseMock({
      first: { occurred_at: "2026-09-01T00:00:00Z" },
      monthRows: rows,
      count: 1500,
    });
    // @ts-expect-error テスト用のモック
    const overResult = await fetchStoryPage(over.client, options);
    assert.equal(!overResult.ok && overResult.reason, "over_limit");
  });

  test("取得エラーは load_error（0件として表示しない）", async () => {
    const { client } = createSupabaseMock({
      first: { occurred_at: "2026-09-01T00:00:00Z" },
      failMonth: true,
    });
    // @ts-expect-error テスト用のモック
    const result = await quiet(() => fetchStoryPage(client, options));
    assert.equal(!result.ok && result.reason, "load_error");
  });

  test("019 適用前の月には注記を出す（適用時刻は初期作成の行から）", async () => {
    const { client } = createSupabaseMock({
      first: { occurred_at: "2026-01-10T00:00:00Z" },
      tracking: { created_at: "2026-10-14T13:00:00Z" },
      monthRows: [],
    });
    // @ts-expect-error テスト用のモック
    const result = await fetchStoryPage(client, { ...options, requestedMonth: "2026-03" });
    assert.ok(result.ok && result.data.showTrackingNote);
    assert.equal(result.ok && result.data.nav.monthKey, "2026-03");
  });
});
