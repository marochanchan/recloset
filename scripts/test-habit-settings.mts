// 週次目標の設定（lib/habit-settings.ts）、フォーム値の検証（lib/habit-progress.ts）、
// 選択肢の表示（lib/habit-progress-copy.ts）の自動テスト。
// Supabaseには接続せず、問い合わせを記録するモックのクライアントを使う。
//
// 実行方法:
//   node --test scripts/test-habit-settings.mts

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

const { fetchWeeklyReviewGoal, saveWeeklyReviewGoal } = await import(
  "../lib/habit-settings.ts"
);
const { parseWeeklyReviewGoalValue, toWeeklyReviewGoalValue, buildWeeklyProgress } =
  await import("../lib/habit-progress.ts");
const { WEEKLY_REVIEW_GOAL_CHOICES, formatWeeklyReviewGoal, getWeeklyReviewMessage } =
  await import("../lib/habit-progress-copy.ts");

type QueryResult = {
  data?: unknown;
  error?: { message: string; code?: string } | null;
};

/** from(table) 以降の呼び出しを記録し、await すると result を返す */
function createMockSupabase(result: QueryResult | Error) {
  const calls: { table: string; method: string; args: unknown[] }[] = [];
  const client = {
    from(table: string) {
      const builder: Record<string, unknown> = {};
      for (const method of ["select", "maybeSingle", "upsert", "single"]) {
        builder[method] = (...args: unknown[]) => {
          calls.push({ table, method, args });
          return builder;
        };
      }
      builder.then = (
        resolve: (value: unknown) => void,
        reject: (reason: unknown) => void,
      ) => {
        if (result instanceof Error) {
          reject(result);
          return;
        }
        resolve({ data: result.data ?? null, error: result.error ?? null });
      };
      return builder;
    },
  };
  return { client, calls };
}

// ログを出すテスト（失敗時の console.error）の出力を抑える
async function quietly<T>(fn: () => Promise<T>): Promise<T> {
  const original = console.error;
  console.error = () => {};
  try {
    return await fn();
  } finally {
    console.error = original;
  }
}

const USER_ID = "aaaaaaaa-0000-4000-8000-00000000000a";
const NOW = new Date("2026-10-14T03:00:00Z");

describe("フォーム値の検証（parseWeeklyReviewGoalValue）", () => {
  test("3・7・14・none を受け付ける", () => {
    assert.deepEqual(parseWeeklyReviewGoalValue("3"), { ok: true, goal: 3 });
    assert.deepEqual(parseWeeklyReviewGoalValue("7"), { ok: true, goal: 7 });
    assert.deepEqual(parseWeeklyReviewGoalValue("14"), { ok: true, goal: 14 });
    assert.deepEqual(parseWeeklyReviewGoalValue("none"), { ok: true, goal: null });
  });

  test("それ以外はすべて拒否する", () => {
    for (const value of [
      "5", "0", "-3", "21", "3.0", " 3", "03", "", "null", "None", "目標なし",
      3, 7, null, undefined, {}, ["3"], true,
    ]) {
      assert.deepEqual(parseWeeklyReviewGoalValue(value), { ok: false }, String(value));
    }
  });

  test("目標とフォーム値の往復", () => {
    for (const goal of [3, 7, 14, null] as const) {
      const parsed = parseWeeklyReviewGoalValue(toWeeklyReviewGoalValue(goal));
      assert.deepEqual(parsed, { ok: true, goal });
    }
  });
});

describe("選択肢の表示", () => {
  test("4つの選択肢と表示名", () => {
    assert.deepEqual(
      WEEKLY_REVIEW_GOAL_CHOICES.map((c) => `${c.value}:${c.label}:${c.description}`),
      [
        "3:週3着:ゆっくりコース",
        "7:週7着:コツコツコース",
        "14:週14着:しっかりコース",
        "none:目標なし:自分のペースで記録する",
      ],
    );
    assert.equal(formatWeeklyReviewGoal(7), "週7着（コツコツコース）");
    assert.equal(formatWeeklyReviewGoal(null), "目標なし（自分のペースで記録する）");
  });

  test("目標なしでは達成の言葉を出さない（着数が多くても）", () => {
    const progress = buildWeeklyProgress({ reviewedItemCount: 20, wearLogCount: 0, goal: null });
    assert.equal(progress.achieved, null);
    assert.equal(progress.progressRate, null);
    assert.equal(getWeeklyReviewMessage(progress), "今週は20着と向き合えたね。");
  });

  test("目標を変えると、同じ実績でも達成の言葉が変わる", () => {
    const at = (goal: 3 | 7 | 14) =>
      getWeeklyReviewMessage(buildWeeklyProgress({ reviewedItemCount: 5, wearLogCount: 0, goal }));
    assert.equal(at(3), "今週の目標達成！服と向き合う時間をつくれたね。");
    assert.equal(at(7), "少しずつ、服と向き合えているね。");
    assert.equal(at(14), "少しずつ、服と向き合えているね。");
  });
});

describe("fetchWeeklyReviewGoal", () => {
  test("未保存（行がない）なら3着", async () => {
    const { client, calls } = createMockSupabase({ data: null });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    assert.deepEqual(await fetchWeeklyReviewGoal(client as any), { ok: true, goal: 3 });
    assert.deepEqual(
      calls.map((c) => `${c.table}.${c.method}`),
      ["user_habit_settings.select", "user_habit_settings.maybeSingle"],
    );
    assert.deepEqual(calls[0].args, ["weekly_review_goal"]);
  });

  test("3・7・14着の設定を返す", async () => {
    for (const goal of [3, 7, 14]) {
      const { client } = createMockSupabase({ data: { weekly_review_goal: goal } });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      assert.deepEqual(await fetchWeeklyReviewGoal(client as any), { ok: true, goal });
    }
  });

  test("null は目標なし", async () => {
    const { client } = createMockSupabase({ data: { weekly_review_goal: null } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    assert.deepEqual(await fetchWeeklyReviewGoal(client as any), { ok: true, goal: null });
  });

  test("選択肢にない値がDBにあっても3着（CHECK制約で通常は起きない）", async () => {
    const { client } = createMockSupabase({ data: { weekly_review_goal: 5 } });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    assert.deepEqual(await fetchWeeklyReviewGoal(client as any), { ok: true, goal: 3 });
  });

  test("取得エラー・例外は ok:false（3着に戻さない）", async () => {
    for (const result of [
      { error: { message: "relation does not exist", code: "42P01" } },
      new Error("network"),
    ]) {
      const { client } = createMockSupabase(result);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      assert.deepEqual(await quietly(() => fetchWeeklyReviewGoal(client as any)), {
        ok: false,
      });
    }
  });
});

describe("saveWeeklyReviewGoal", () => {
  test("本人のID・目標・更新日時をupsertし、保存後の値を読み戻す", async () => {
    for (const goal of [3, 7, 14, null] as const) {
      const { client, calls } = createMockSupabase({ data: { weekly_review_goal: goal } });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await saveWeeklyReviewGoal(client as any, USER_ID, goal, NOW);
      assert.deepEqual(result, { ok: true, goal });
      assert.deepEqual(
        calls.map((c) => `${c.table}.${c.method}`),
        [
          "user_habit_settings.upsert",
          "user_habit_settings.select",
          "user_habit_settings.single",
        ],
      );
      assert.deepEqual(calls[0].args, [
        { user_id: USER_ID, weekly_review_goal: goal, updated_at: NOW.toISOString() },
        { onConflict: "user_id" },
      ]);
      assert.deepEqual(calls[1].args, ["weekly_review_goal"]);
    }
  });

  test("CHECK制約違反は invalid", async () => {
    const { client } = createMockSupabase({
      error: { message: "violates check constraint", code: "23514" },
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    assert.deepEqual(await quietly(() => saveWeeklyReviewGoal(client as any, USER_ID, 7, NOW)), {
      ok: false,
      reason: "invalid",
    });
  });

  test("RLS・権限エラー、テーブルがない場合、例外は failed", async () => {
    for (const result of [
      { error: { message: "new row violates row-level security policy", code: "42501" } },
      { error: { message: "Could not find the table", code: "PGRST205" } },
      new Error("network"),
    ]) {
      const { client } = createMockSupabase(result);
      assert.deepEqual(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await quietly(() => saveWeeklyReviewGoal(client as any, USER_ID, 7, NOW)),
        { ok: false, reason: "failed" },
      );
    }
  });

  test("読み戻した値が送った値と違えば failed", async () => {
    for (const data of [null, { weekly_review_goal: 3 }, { weekly_review_goal: null }]) {
      const { client } = createMockSupabase({ data });
      assert.deepEqual(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await quietly(() => saveWeeklyReviewGoal(client as any, USER_ID, 7, NOW)),
        { ok: false, reason: "failed" },
        JSON.stringify(data),
      );
    }
  });
});
