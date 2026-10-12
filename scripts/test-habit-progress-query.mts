// 今週の進捗の取得（lib/habit-progress-query.ts）と表示の言葉
// （lib/habit-progress-copy.ts）の自動テスト。
// Supabaseには接続せず、問い合わせを記録するモックのクライアントを使う。
//
// 実行方法:
//   node --test scripts/test-habit-progress-query.mts

import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { describe, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

// "@/lib/xxx"（tsconfigのpaths）を、Node.jsが読めるリポジトリ内の .ts に解決する
const repoRoot = fileURLToPath(new URL("..", import.meta.url));
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      return nextResolve(
        pathToFileURL(`${repoRoot}${specifier.slice(2)}.ts`).href,
        context,
      );
    }
    return nextResolve(specifier, context);
  },
});

const { fetchWeeklyProgress } = await import("../lib/habit-progress-query.ts");
const { getWeeklyReviewMessage, getWeeklyWearMessage } = await import(
  "../lib/habit-progress-copy.ts"
);
const { buildWeeklyProgress } = await import("../lib/habit-progress.ts");

type TableResult = {
  /** maybeSingle() で取得するテーブル（user_habit_settings）は行のオブジェクトかnull */
  data?: unknown[] | Record<string, unknown> | null;
  count?: number | null;
  error?: { message: string } | null;
};

/** from(table) 以降のメソッド呼び出しを記録し、await するとテーブルごとの結果を返す */
function createMockSupabase(results: Record<string, TableResult | Error>) {
  const calls: { table: string; method: string; args: unknown[] }[] = [];
  const client = {
    from(table: string) {
      const builder: Record<string, unknown> = {};
      for (const method of ["select", "gte", "lt", "neq", "limit", "maybeSingle"]) {
        builder[method] = (...args: unknown[]) => {
          calls.push({ table, method, args });
          return builder;
        };
      }
      builder.then = (
        resolve: (value: unknown) => void,
        reject: (reason: unknown) => void,
      ) => {
        const result = results[table];
        if (result instanceof Error) {
          reject(result);
          return;
        }
        resolve({
          data: result?.data ?? null,
          count: result?.count ?? null,
          error: result?.error ?? null,
        });
      };
      return builder;
    },
  };
  return { client, calls };
}

// 2026-10-12（月）〜 2026-10-18（日）の週。水曜12:00 JST
const NOW = new Date("2026-10-14T03:00:00Z");
const START = "2026-10-11T15:00:00.000Z";
const END = "2026-10-18T15:00:00.000Z";
const IN_WEEK = "2026-10-13T01:00:00Z";

const okResults = (overrides: Record<string, TableResult | Error> = {}) => ({
  ai_diagnoses: {
    data: [
      { clothing_item_id: "a", created_at: IN_WEEK },
      { clothing_item_id: "a", created_at: IN_WEEK },
      { clothing_item_id: "b", created_at: IN_WEEK },
    ],
  },
  closet_review_decisions: {
    data: [
      { clothing_item_id: "b", decision: "keep", created_at: IN_WEEK },
      { clothing_item_id: "c", decision: "unsure", created_at: IN_WEEK },
    ],
  },
  wear_logs: { count: 5 },
  ...overrides,
});

describe("fetchWeeklyProgress", () => {
  test("AI診断とスワイプを合わせて重複を除き、着用は件数で別に数える", async () => {
    const { client } = createMockSupabase(okResults());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await fetchWeeklyProgress(client as any, NOW);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.progress.reviewedItemCount, 3); // a, b, c
    assert.equal(result.progress.wearLogCount, 5);
    assert.equal(result.progress.goal, 3);
    assert.equal(result.progress.achieved, true);
    assert.equal(result.progress.progressRate, 1);
    assert.equal(result.range.weekStartDateKey, "2026-10-12");
  });

  test("週の範囲（UTCの開始以上・終了未満）とskip除外で問い合わせる", async () => {
    const { client, calls } = createMockSupabase(okResults());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await fetchWeeklyProgress(client as any, NOW);
    for (const [table, column] of [
      ["ai_diagnoses", "created_at"],
      ["closet_review_decisions", "created_at"],
      ["wear_logs", "worn_at"],
    ]) {
      const of = (method: string) =>
        calls.filter((call) => call.table === table && call.method === method);
      assert.deepEqual(of("gte")[0]?.args, [column, START], `${table} gte`);
      assert.deepEqual(of("lt")[0]?.args, [column, END], `${table} lt`);
    }
    assert.deepEqual(
      calls.find((c) => c.table === "closet_review_decisions" && c.method === "neq")
        ?.args,
      ["decision", "skip"],
    );
    // 着用記録は行を取得せず件数だけ
    assert.deepEqual(
      calls.find((c) => c.table === "wear_logs" && c.method === "select")?.args,
      ["*", { count: "exact", head: true }],
    );
  });

  test("問い合わせが1つでも失敗したら ok:false（0着と誤表示しない）", async () => {
    for (const table of ["ai_diagnoses", "closet_review_decisions", "wear_logs"]) {
      const { client } = createMockSupabase(
        okResults({ [table]: { error: { message: "boom" } } }),
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await fetchWeeklyProgress(client as any, NOW);
      assert.deepEqual(result, { ok: false }, table);
    }
  });

  test("通信の例外も ok:false", async () => {
    const { client } = createMockSupabase(
      okResults({ wear_logs: new Error("network") }),
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await fetchWeeklyProgress(client as any, NOW);
    assert.deepEqual(result, { ok: false });
  });

  test("件数が取れない・上限に達した場合も ok:false", async () => {
    const noCount = createMockSupabase(okResults({ wear_logs: { count: null } }));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    assert.deepEqual(await fetchWeeklyProgress(noCount.client as any, NOW), {
      ok: false,
    });
    const full = createMockSupabase(
      okResults({
        ai_diagnoses: {
          data: Array.from({ length: 1000 }, (_, i) => ({
            clothing_item_id: `x${i}`,
            created_at: IN_WEEK,
          })),
        },
      }),
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    assert.deepEqual(await fetchWeeklyProgress(full.client as any, NOW), {
      ok: false,
    });
  });

  test("履歴が0件なら 0着・0回（成功として）", async () => {
    const { client } = createMockSupabase({
      ai_diagnoses: { data: [] },
      closet_review_decisions: { data: [] },
      wear_logs: { count: 0 },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await fetchWeeklyProgress(client as any, NOW);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.progress.reviewedItemCount, 0);
    assert.equal(result.progress.wearLogCount, 0);
    assert.equal(result.progress.achieved, false);
  });
});

describe("fetchWeeklyProgress（週次目標）", () => {
  // 見直し3着（a, b, c）・着用5回の週
  const withGoal = (setting: TableResult | Error) =>
    createMockSupabase(okResults({ user_habit_settings: setting }));

  test("未保存（行がない）なら3着", async () => {
    const { client, calls } = withGoal({ data: null });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await fetchWeeklyProgress(client as any, NOW);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.progress.goal, 3);
    assert.equal(result.goalLoadFailed, false);
    assert.deepEqual(
      calls.filter((c) => c.table === "user_habit_settings").map((c) => c.method),
      ["select", "maybeSingle"],
    );
  });

  test("3・7・14着の設定で進捗率・達成・残りを計算し直す", async () => {
    const expected = [
      { goal: 3, rate: 1, achieved: true, remaining: 0 },
      { goal: 7, rate: 3 / 7, achieved: false, remaining: 4 },
      { goal: 14, rate: 3 / 14, achieved: false, remaining: 11 },
    ];
    for (const { goal, rate, achieved, remaining } of expected) {
      const { client } = withGoal({ data: { weekly_review_goal: goal } });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await fetchWeeklyProgress(client as any, NOW);
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.progress.goal, goal);
      assert.equal(result.progress.reviewedItemCount, 3, "実績は目標で変わらない");
      assert.equal(result.progress.wearLogCount, 5, "着用は目標に含めない");
      assert.equal(result.progress.progressRate, rate, `goal ${goal}`);
      assert.equal(result.progress.achieved, achieved, `goal ${goal}`);
      assert.equal(result.progress.remainingToGoal, remaining, `goal ${goal}`);
      assert.equal(result.goalLoadFailed, false);
    }
  });

  test("null は目標なし（進捗率・達成・残りなし）", async () => {
    const { client } = withGoal({ data: { weekly_review_goal: null } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await fetchWeeklyProgress(client as any, NOW);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.progress.goal, null);
    assert.equal(result.progress.progressRate, null);
    assert.equal(result.progress.achieved, null);
    assert.equal(result.progress.remainingToGoal, null);
    assert.equal(result.goalLoadFailed, false);
    assert.equal(getWeeklyReviewMessage(result.progress), "今週は3着と向き合えたね。");
  });

  test("目標の取得に失敗しても実績は表示し、3着に戻さない", async () => {
    for (const setting of [
      { error: { message: "relation does not exist" } },
      new Error("network"),
    ]) {
      const { client } = withGoal(setting);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await fetchWeeklyProgress(client as any, NOW);
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.goalLoadFailed, true);
      assert.equal(result.progress.goal, null, "3着に戻さない");
      assert.equal(result.progress.progressRate, null, "進捗率を出さない");
      assert.equal(result.progress.achieved, null, "達成判定を出さない");
      assert.equal(result.progress.reviewedItemCount, 3);
      assert.equal(result.progress.wearLogCount, 5);
    }
  });

  test("実績の取得に失敗したら、目標が取れても ok:false", async () => {
    const { client } = createMockSupabase(
      okResults({
        wear_logs: { error: { message: "boom" } },
        user_habit_settings: { data: { weekly_review_goal: 7 } },
      }),
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    assert.deepEqual(await fetchWeeklyProgress(client as any, NOW), { ok: false });
  });
});

describe("表示の言葉", () => {
  const progress = (reviewedItemCount: number, wearLogCount = 0) =>
    buildWeeklyProgress({ reviewedItemCount, wearLogCount, goal: 3 });

  test("見直し: 0着・1〜2着・3着以上", () => {
    assert.equal(getWeeklyReviewMessage(progress(0)), "今週はどの服から見直してみる？");
    assert.equal(getWeeklyReviewMessage(progress(1)), "少しずつ、服と向き合えているね。");
    assert.equal(getWeeklyReviewMessage(progress(2)), "少しずつ、服と向き合えているね。");
    assert.equal(
      getWeeklyReviewMessage(progress(3)),
      "今週の目標達成！服と向き合う時間をつくれたね。",
    );
    assert.equal(
      getWeeklyReviewMessage(progress(8)),
      "今週の目標達成！服と向き合う時間をつくれたね。",
    );
  });

  test("目標なし: 着数を肯定的に伝える", () => {
    const noGoal = buildWeeklyProgress({ reviewedItemCount: 2, wearLogCount: 0, goal: null });
    assert.equal(getWeeklyReviewMessage(noGoal), "今週は2着と向き合えたね。");
  });

  test("着用: 0回でも責めず、記録があれば回数を伝える", () => {
    assert.equal(getWeeklyWearMessage(progress(0, 0)), "着た日は、服の詳細から記録できます。");
    assert.equal(getWeeklyWearMessage(progress(0, 4)), "今週は4回、服を着た記録があります。");
  });

  test("着用回数が多くても見直しの言葉は変わらない", () => {
    assert.equal(getWeeklyReviewMessage(progress(0, 20)), "今週はどの服から見直してみる？");
  });
});
