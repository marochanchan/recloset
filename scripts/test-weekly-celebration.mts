// 週次目標の達成演出（lib/weekly-celebration.ts）と、後から表示される要素への
// # スクロールの判定（lib/hash-scroll.ts）の自動テスト。
// DB・ネットワーク・ブラウザには接続せず、localStorage は架空のものに置き換える。
//
// 実行方法:
//   node --test scripts/test-weekly-celebration.mts

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { getHashScrollBehavior, isHashTarget } from "../lib/hash-scroll.ts";
import { buildWeeklyProgress, getJstWeekRangeUtc } from "../lib/habit-progress.ts";
import {
  claimWeeklyGoalCelebration,
  getBrowserStorage,
  WEEKLY_GOAL_CELEBRATION_MOTION_CLASS,
  WEEKLY_GOAL_CELEBRATION_STORAGE_KEY,
  type CelebrationStorage,
} from "../lib/weekly-celebration.ts";

function createMemoryStorage(): CelebrationStorage & { values: Map<string, string> } {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

// 2026-10-12（月）〜 2026-10-18（日）の週と、その次の週
const THIS_WEEK = getJstWeekRangeUtc(new Date("2026-10-14T03:00:00Z")).weekStartDateKey;
const NEXT_WEEK = getJstWeekRangeUtc(new Date("2026-10-19T03:00:00Z")).weekStartDateKey;

/** 実績と目標からサーバーと同じ方法で achieved を求める */
const achievedFor = (reviewedItemCount: number, goal: 3 | 7 | 14 | null) =>
  buildWeeklyProgress({ reviewedItemCount, wearLogCount: 0, goal }).achieved;

describe("達成演出を出すか（claimWeeklyGoalCelebration）", () => {
  test("週の初日は日本時間の月曜", () => {
    assert.equal(THIS_WEEK, "2026-10-12");
    assert.equal(NEXT_WEEK, "2026-10-19");
  });

  test("未達成・目標なし・目標の取得失敗では出さず、表示済みにもしない", () => {
    const storage = createMemoryStorage();
    for (const achieved of [achievedFor(2, 3), achievedFor(20, null), null, false]) {
      assert.equal(
        claimWeeklyGoalCelebration({ achieved, weekStartDateKey: THIS_WEEK, storage }),
        false,
      );
    }
    assert.equal(storage.values.size, 0, "未達成では記録しない");
  });

  test("達成したら一度だけ出し、同じ週の2回目以降は出さない", () => {
    const storage = createMemoryStorage();
    const achieved = achievedFor(3, 3);
    assert.equal(achieved, true);
    assert.equal(claimWeeklyGoalCelebration({ achieved, weekStartDateKey: THIS_WEEK, storage }), true);
    assert.equal(storage.values.get(WEEKLY_GOAL_CELEBRATION_STORAGE_KEY), THIS_WEEK);
    assert.equal(claimWeeklyGoalCelebration({ achieved, weekStartDateKey: THIS_WEEK, storage }), false);
    assert.equal(claimWeeklyGoalCelebration({ achieved, weekStartDateKey: THIS_WEEK, storage }), false);
  });

  test("週が変わったら、達成すれば再び出す", () => {
    const storage = createMemoryStorage();
    claimWeeklyGoalCelebration({ achieved: true, weekStartDateKey: THIS_WEEK, storage });
    // 翌週の月曜はまだ0着（未達成）
    assert.equal(
      claimWeeklyGoalCelebration({ achieved: achievedFor(0, 3), weekStartDateKey: NEXT_WEEK, storage }),
      false,
    );
    assert.equal(
      claimWeeklyGoalCelebration({ achieved: achievedFor(3, 3), weekStartDateKey: NEXT_WEEK, storage }),
      true,
    );
    assert.equal(storage.values.get(WEEKLY_GOAL_CELEBRATION_STORAGE_KEY), NEXT_WEEK);
  });

  test("週の途中で目標を変えても、同じ週には2回お祝いしない", () => {
    const storage = createMemoryStorage();
    // 週3着で達成 → お祝い
    assert.equal(
      claimWeeklyGoalCelebration({ achieved: achievedFor(3, 3), weekStartDateKey: THIS_WEEK, storage }),
      true,
    );
    // 週7着に上げる → 3着では未達成
    assert.equal(
      claimWeeklyGoalCelebration({ achieved: achievedFor(3, 7), weekStartDateKey: THIS_WEEK, storage }),
      false,
    );
    // 同じ週に7着に到達しても、もう一度は出さない
    assert.equal(
      claimWeeklyGoalCelebration({ achieved: achievedFor(7, 7), weekStartDateKey: THIS_WEEK, storage }),
      false,
    );
    // 目標を下げて再び達成しても出さない
    assert.equal(
      claimWeeklyGoalCelebration({ achieved: achievedFor(3, 3), weekStartDateKey: THIS_WEEK, storage }),
      false,
    );
  });

  test("目標を上げて未達成から達成したときは、その週はじめてならお祝いする", () => {
    const storage = createMemoryStorage();
    assert.equal(
      claimWeeklyGoalCelebration({ achieved: achievedFor(5, 7), weekStartDateKey: THIS_WEEK, storage }),
      false,
    );
    assert.equal(
      claimWeeklyGoalCelebration({ achieved: achievedFor(7, 7), weekStartDateKey: THIS_WEEK, storage }),
      true,
    );
  });

  test("localStorage が使えない場合は出さず、例外も投げない", () => {
    const throwingGet: CelebrationStorage = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {},
    };
    const throwingSet: CelebrationStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    for (const storage of [null, throwingGet, throwingSet]) {
      assert.equal(
        claimWeeklyGoalCelebration({ achieved: true, weekStartDateKey: THIS_WEEK, storage }),
        false,
      );
    }
  });

  test("週のキーが空なら出さない", () => {
    const storage = createMemoryStorage();
    assert.equal(claimWeeklyGoalCelebration({ achieved: true, weekStartDateKey: "", storage }), false);
  });

  test("ブラウザ以外（サーバー描画時）では storage を取得しない", () => {
    assert.equal(getBrowserStorage(), null);
  });

  test("視差効果を減らす設定では動かさない（動きはすべて motion-safe のみ）", () => {
    const classes = WEEKLY_GOAL_CELEBRATION_MOTION_CLASS.split(/\s+/);
    assert.ok(classes.length > 0);
    for (const name of classes) {
      assert.ok(name.startsWith("motion-safe:"), name);
    }
  });
});

describe("後から表示される要素への # スクロール（lib/hash-scroll.ts）", () => {
  const ID = "review-suggestions-title";

  test("# が対象のidを指しているときだけスクロールする", () => {
    assert.equal(isHashTarget(`#${ID}`, ID), true);
    for (const hash of ["", "#", `#${ID}x`, `#x${ID}`, ID, "#review-suggestions", "#%E0%A4%A"]) {
      assert.equal(isHashTarget(hash, ID), false, hash);
    }
    assert.equal(isHashTarget(`#${ID}`, ""), false);
  });

  test("URLエンコードされた # も判定できる", () => {
    assert.equal(isHashTarget("#%E4%BB%8A%E6%97%A5", "今日"), true);
  });

  test("視差効果を減らす設定ではなめらかに動かさない", () => {
    assert.equal(getHashScrollBehavior(true), "auto");
    assert.equal(getHashScrollBehavior(false), "smooth");
  });
});
