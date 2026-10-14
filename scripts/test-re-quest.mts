// Re:Quest（lib/closet-activity.ts・lib/re-quest.ts・lib/re-quest-copy.ts・
// lib/re-quest-query.ts）の自動テスト。DB・ネットワーク・ブラウザには接続しない
// （Supabaseクライアントはモックを使う）。
//
// 実行方法:
//   node --test scripts/test-re-quest.mts

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
  getWeekDateKeys,
  summarizeActivitiesByDay,
  toClosetActivities,
  toJstDateKey,
} = await import("../lib/closet-activity.ts");
const { getJstWeekRangeUtc, toReviewActivities } = await import(
  "../lib/habit-progress.ts"
);
const {
  buildReQuestProgress,
  claimReQuestCelebration,
  RE_QUEST_CELEBRATION_STORAGE_KEY,
} = await import("../lib/re-quest.ts");
const { getActiveDaysMessage, getReQuestMessage, RE_QUEST_LEAD } = await import(
  "../lib/re-quest-copy.ts"
);
const { fetchReQuestProgress } = await import("../lib/re-quest-query.ts");

// 2026-10-15（木）12:00 JST。週は 10/12（月）〜10/18（日）
const NOW = new Date("2026-10-15T03:00:00Z");
const RANGE = getJstWeekRangeUtc(NOW);

type Activity = { kind: "register" | "review" | "wear"; clothingItemId: string; occurredAt: string };
const act = (kind: Activity["kind"], clothingItemId: string, occurredAt: string): Activity => ({
  kind,
  clothingItemId,
  occurredAt,
});

describe("toJstDateKey・getWeekDateKeys（日本時間の境界）", () => {
  test("UTC 14:59 は同じ日、15:00 は翌日（日本時間0:00）", () => {
    assert.equal(toJstDateKey("2026-10-14T14:59:59.999Z"), "2026-10-14");
    assert.equal(toJstDateKey("2026-10-14T15:00:00Z"), "2026-10-15");
  });

  test("不正な時刻はnull", () => {
    assert.equal(toJstDateKey("not-a-date"), null);
  });

  test("週の7日分（月曜→日曜）", () => {
    assert.deepEqual(getWeekDateKeys(RANGE), [
      "2026-10-12",
      "2026-10-13",
      "2026-10-14",
      "2026-10-15",
      "2026-10-16",
      "2026-10-17",
      "2026-10-18",
    ]);
  });
});

describe("toClosetActivities", () => {
  test("登録・見直し・着用を同じ形にまとめる（見直しのskipは除く）", () => {
    const activities = toClosetActivities({
      registeredItems: [{ id: "a", created_at: "2026-10-15T01:00:00Z" }],
      reviewActivities: toReviewActivities({
        aiDiagnoses: [{ clothing_item_id: "b", created_at: "2026-10-15T01:00:00Z" }],
        swipeDecisions: [
          { clothing_item_id: "c", decision: "keep", created_at: "2026-10-15T01:00:00Z" },
          { clothing_item_id: "d", decision: "skip", created_at: "2026-10-15T01:00:00Z" },
        ],
      }),
      wearLogs: [{ clothing_item_id: "e", worn_at: "2026-10-15T01:00:00Z" }],
    });
    assert.deepEqual(
      activities.map((activity) => `${activity.kind}:${activity.clothingItemId}`),
      ["register:a", "review:b", "review:c", "wear:e"],
    );
  });
});

describe("summarizeActivitiesByDay（重複・範囲）", () => {
  test("同じ日に同じ服を複数回見直しても1着（AI診断とスワイプの両方でも1着）", () => {
    const [, , , thursday] = summarizeActivitiesByDay(
      [
        act("review", "a", "2026-10-15T00:00:00Z"),
        act("review", "a", "2026-10-15T05:00:00Z"),
        act("review", "b", "2026-10-15T05:00:00Z"),
      ],
      RANGE,
    );
    assert.equal(thursday.reviewedItemCount, 2);
  });

  test("別の日の同じ服は、それぞれの日に1着", () => {
    const days = summarizeActivitiesByDay(
      [
        act("review", "a", "2026-10-13T00:00:00Z"),
        act("review", "a", "2026-10-15T00:00:00Z"),
      ],
      RANGE,
    );
    assert.equal(days[1].reviewedItemCount, 1);
    assert.equal(days[3].reviewedItemCount, 1);
  });

  test("着用記録は回数で数える", () => {
    const [, , , thursday] = summarizeActivitiesByDay(
      [act("wear", "a", "2026-10-15T00:00:00Z"), act("wear", "a", "2026-10-15T01:00:00Z")],
      RANGE,
    );
    assert.equal(thursday.wearLogCount, 2);
  });

  test("週の範囲外（前週の日曜23:59 JST・翌週の月曜0:00 JST）は数えない", () => {
    const days = summarizeActivitiesByDay(
      [
        act("register", "a", "2026-10-11T14:59:59Z"),
        act("register", "b", "2026-10-18T15:00:00Z"),
        act("register", "c", "2026-10-11T15:00:00Z"),
      ],
      RANGE,
    );
    assert.equal(days[0].registeredItemCount, 1);
    assert.equal(
      days.reduce((sum, day) => sum + day.registeredItemCount, 0),
      1,
    );
  });
});

describe("buildReQuestProgress（達成判定・週次）", () => {
  test("何もしていない日: 未達成・0日", () => {
    const progress = buildReQuestProgress({ activities: [], range: RANGE, now: NOW });
    assert.equal(progress.todayDateKey, "2026-10-15");
    assert.equal(progress.achievedToday, false);
    assert.deepEqual(
      progress.quests.map((quest) => [quest.kind, quest.done]),
      [
        ["register", false],
        ["review", false],
        ["wear", false],
      ],
    );
    assert.equal(progress.activeDaysThisWeek, 0);
    assert.equal(progress.week.filter((day) => day.isToday).length, 1);
    assert.equal(progress.week[3].isToday, true);
  });

  test("どれか1つで達成。大量に登録しても達成は1つ（着数は表示用）", () => {
    const activities = Array.from({ length: 30 }, (_, index) =>
      act("register", `item-${index}`, "2026-10-15T01:00:00Z"),
    );
    const progress = buildReQuestProgress({ activities, range: RANGE, now: NOW });
    assert.equal(progress.achievedToday, true);
    assert.deepEqual(
      progress.quests.filter((quest) => quest.done).map((quest) => quest.kind),
      ["register"],
    );
    assert.equal(progress.quests[0].count, 30);
    assert.equal(progress.activeDaysThisWeek, 1);
  });

  test("前日の行動は今日の達成にしないが、今週の行動日数には数える", () => {
    const progress = buildReQuestProgress({
      activities: [
        act("wear", "a", "2026-10-12T01:00:00Z"),
        act("review", "b", "2026-10-14T14:59:00Z"),
        act("review", "c", "2026-10-14T10:00:00Z"),
      ],
      range: RANGE,
      now: NOW,
    });
    assert.equal(progress.achievedToday, false);
    assert.equal(progress.activeDaysThisWeek, 2);
    assert.deepEqual(
      progress.week.map((day) => day.active),
      [true, false, true, false, false, false, false],
    );
  });

  test("日本時間0:00直後の行動は今日の達成", () => {
    const progress = buildReQuestProgress({
      activities: [act("wear", "a", "2026-10-14T15:00:00Z")],
      range: RANGE,
      now: NOW,
    });
    assert.equal(progress.achievedToday, true);
  });
});

describe("claimReQuestCelebration（同じ日に一度だけ）", () => {
  const createStorage = () => {
    const data = new Map<string, string>();
    return {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value),
      data,
    };
  };

  test("達成した日の最初だけ表示し、同じ日の2回目は表示しない", () => {
    const storage = createStorage();
    const args = { achievedToday: true, todayDateKey: "2026-10-15", storage };
    assert.equal(claimReQuestCelebration(args), true);
    assert.equal(storage.data.get(RE_QUEST_CELEBRATION_STORAGE_KEY), "2026-10-15");
    assert.equal(claimReQuestCelebration(args), false);
    assert.equal(
      claimReQuestCelebration({ ...args, todayDateKey: "2026-10-16" }),
      true,
    );
  });

  test("未達成・storageなし・読み書きの失敗では表示しない", () => {
    assert.equal(
      claimReQuestCelebration({
        achievedToday: false,
        todayDateKey: "2026-10-15",
        storage: createStorage(),
      }),
      false,
    );
    assert.equal(
      claimReQuestCelebration({ achievedToday: true, todayDateKey: "2026-10-15", storage: null }),
      false,
    );
    assert.equal(
      claimReQuestCelebration({
        achievedToday: true,
        todayDateKey: "2026-10-15",
        storage: {
          getItem: () => {
            throw new Error("blocked");
          },
          setItem: () => {},
        },
      }),
      false,
    );
  });
});

test("文言: 未達成・0日でも否定しない", () => {
  const empty = buildReQuestProgress({ activities: [], range: RANGE, now: NOW });
  assert.equal(getReQuestMessage(empty), RE_QUEST_LEAD);
  assert.match(getActiveDaysMessage(0), /ここから/);
  assert.equal(getActiveDaysMessage(3), "今週は3日、服と向き合いました。");
});

// ------------------------------------------------------------
// fetchReQuestProgress（Supabaseのモック）
// ------------------------------------------------------------

type TableResult = { data: unknown[] | null; error: unknown };

function createSupabaseMock(results: Record<string, TableResult>) {
  const calls: { table: string; filters: string[] }[] = [];
  const client = {
    from(table: string) {
      const call = { table, filters: [] as string[] };
      calls.push(call);
      const builder = {
        select: (columns: string) => (call.filters.push(`select:${columns}`), builder),
        gte: (column: string, value: string) => (call.filters.push(`gte:${column}:${value}`), builder),
        lt: (column: string, value: string) => (call.filters.push(`lt:${column}:${value}`), builder),
        neq: (column: string, value: string) => (call.filters.push(`neq:${column}:${value}`), builder),
        limit: (count: number) => (call.filters.push(`limit:${count}`), builder),
        then: (resolve: (value: TableResult) => unknown) =>
          resolve(results[table] ?? { data: [], error: null }),
      };
      return builder;
    },
  };
  return { client, calls };
}

describe("fetchReQuestProgress", () => {
  test("今週の範囲・必要な列だけを読み、skipを除いて集計する", async () => {
    const { client, calls } = createSupabaseMock({
      clothing_items: { data: [{ id: "a", created_at: "2026-10-15T01:00:00Z" }], error: null },
      wear_logs: { data: [], error: null },
      ai_diagnoses: { data: [], error: null },
      closet_review_decisions: { data: [], error: null },
    });
    // @ts-expect-error テスト用のモック
    const result = await fetchReQuestProgress(client, NOW);
    assert.equal(result.ok, true);
    assert.equal(result.ok && result.progress.achievedToday, true);

    const items = calls.find((call) => call.table === "clothing_items");
    assert.ok(items?.filters.includes("select:id, created_at"));
    assert.ok(items?.filters.includes(`gte:created_at:${RANGE.startUtc.toISOString()}`));
    assert.ok(items?.filters.includes(`lt:created_at:${RANGE.endUtc.toISOString()}`));
    const swipes = calls.find((call) => call.table === "closet_review_decisions");
    assert.ok(swipes?.filters.includes("neq:decision:skip"));
  });

  test("取得エラーは ok:false（未達成と誤表示しない）", async () => {
    const { client } = createSupabaseMock({
      wear_logs: { data: null, error: { message: "boom" } },
    });
    const originalError = console.error;
    console.error = () => {};
    try {
      // @ts-expect-error テスト用のモック
      assert.deepEqual(await fetchReQuestProgress(client, NOW), { ok: false });
    } finally {
      console.error = originalError;
    }
  });

  test("上限件数（1000件）に達したら数え漏れを避けて ok:false", async () => {
    const { client } = createSupabaseMock({
      clothing_items: {
        data: Array.from({ length: 1000 }, (_, index) => ({
          id: `item-${index}`,
          created_at: "2026-10-15T01:00:00Z",
        })),
        error: null,
      },
    });
    const originalError = console.error;
    console.error = () => {};
    try {
      // @ts-expect-error テスト用のモック
      assert.deepEqual(await fetchReQuestProgress(client, NOW), { ok: false });
    } finally {
      console.error = originalError;
    }
  });
});
