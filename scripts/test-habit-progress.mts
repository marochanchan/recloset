// 週次集計（lib/habit-progress.ts）の自動テスト。
// DB・AI・ネットワークには接続せず、固定の架空データだけを使う。
//
// 実行方法:
//   node --test scripts/test-habit-progress.mts

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  buildWeeklyProgress,
  countReviewedItems,
  countWearLogs,
  getJstWeekRangeUtc,
  getReviewedItemIds,
  resolveWeeklyReviewGoal,
  toReviewActivities,
  type AiDiagnosisRow,
  type SwipeDecisionRow,
} from "../lib/habit-progress.ts";

// 2026-10-12（月）〜 2026-10-18（日）の週（日本時間）
const NOW = new Date("2026-10-14T03:00:00Z"); // 水曜12:00 JST
const WEEK = getJstWeekRangeUtc(NOW);
const IN_WEEK = "2026-10-13T01:00:00Z"; // 火曜10:00 JST
const IN_WEEK_2 = "2026-10-16T09:00:00Z"; // 金曜18:00 JST
const LAST_WEEK = "2026-10-10T03:00:00Z"; // 前の週の土曜12:00 JST

const ai = (id: string, at = IN_WEEK): AiDiagnosisRow => ({
  clothing_item_id: id,
  created_at: at,
});
const swipe = (
  id: string,
  decision: string,
  at = IN_WEEK,
): SwipeDecisionRow => ({ clothing_item_id: id, decision, created_at: at });

const reviewedCount = (
  aiDiagnoses: AiDiagnosisRow[],
  swipeDecisions: SwipeDecisionRow[],
  range = WEEK,
) => countReviewedItems(toReviewActivities({ aiDiagnoses, swipeDecisions }), range);

describe("週の範囲（日本時間の月曜0:00〜翌月曜0:00）", () => {
  test("水曜の週は月曜0:00 JST（=日曜15:00 UTC）から7日間", () => {
    assert.equal(WEEK.startUtc.toISOString(), "2026-10-11T15:00:00.000Z");
    assert.equal(WEEK.endUtc.toISOString(), "2026-10-18T15:00:00.000Z");
    assert.equal(WEEK.weekStartDateKey, "2026-10-12");
  });

  test("日曜23:59 JSTと月曜0:00 JSTは別の週", () => {
    const sundayLate = new Date("2026-10-18T14:59:00Z"); // 日曜23:59 JST
    const mondayStart = new Date("2026-10-18T15:00:00Z"); // 月曜0:00 JST
    assert.equal(getJstWeekRangeUtc(sundayLate).weekStartDateKey, "2026-10-12");
    assert.equal(getJstWeekRangeUtc(mondayStart).weekStartDateKey, "2026-10-19");
    // 範囲は開始を含み、終了を含まない
    assert.equal(reviewedCount([ai("a", "2026-10-18T14:59:59Z")], []), 1);
    assert.equal(reviewedCount([ai("a", "2026-10-18T15:00:00Z")], []), 0);
    assert.equal(reviewedCount([ai("a", "2026-10-11T15:00:00Z")], []), 1);
    assert.equal(reviewedCount([ai("a", "2026-10-11T14:59:59Z")], []), 0);
  });

  test("月曜0:00 JSTちょうどはその週の始まり", () => {
    const range = getJstWeekRangeUtc(new Date("2026-10-11T15:00:00Z"));
    assert.equal(range.weekStartDateKey, "2026-10-12");
  });

  test("年末年始をまたぐ週（2026-12-28 月 〜 2027-01-03 日）", () => {
    const newYearsDay = getJstWeekRangeUtc(new Date("2027-01-01T03:00:00Z"));
    assert.equal(newYearsDay.weekStartDateKey, "2026-12-28");
    assert.equal(newYearsDay.startUtc.toISOString(), "2026-12-27T15:00:00.000Z");
    assert.equal(newYearsDay.endUtc.toISOString(), "2027-01-03T15:00:00.000Z");
    // UTCではまだ12月31日でも、JSTで1月1日なら同じ週
    const utcNewYearsEve = getJstWeekRangeUtc(new Date("2026-12-31T16:00:00Z"));
    assert.equal(utcNewYearsEve.weekStartDateKey, "2026-12-28");
  });

  test("月をまたぐ週（2026-11-30 月 〜 2026-12-06 日）", () => {
    const range = getJstWeekRangeUtc(new Date("2026-12-02T03:00:00Z"));
    assert.equal(range.weekStartDateKey, "2026-11-30");
    assert.equal(range.endUtc.toISOString(), "2026-12-06T15:00:00.000Z");
  });

  test("UTCでは日曜でも、JSTで月曜なら新しい週", () => {
    // 2026-10-18T20:00Z = 2026-10-19（月）05:00 JST
    const range = getJstWeekRangeUtc(new Date("2026-10-18T20:00:00Z"));
    assert.equal(range.weekStartDateKey, "2026-10-19");
  });
});

describe("見直し着数（AI診断＋スワイプ、同じ服は1着）", () => {
  test("同じ服のAI診断2回 → 1着", () => {
    assert.equal(reviewedCount([ai("a"), ai("a", IN_WEEK_2)], []), 1);
  });

  test("同じ服のAI診断＋スワイプ → 1着", () => {
    assert.equal(reviewedCount([ai("a")], [swipe("a", "keep", IN_WEEK_2)]), 1);
  });

  test("異なる服のAI診断 → 2着", () => {
    assert.equal(reviewedCount([ai("a"), ai("b")], []), 2);
  });

  test("スワイプのskipのみ → 0着", () => {
    assert.equal(reviewedCount([], [swipe("a", "skip"), swipe("b", "skip")]), 0);
  });

  test("skipと有効な判断が混ざる → 有効な判断の服だけ", () => {
    const ids = getReviewedItemIds(
      toReviewActivities({
        aiDiagnoses: [],
        swipeDecisions: [swipe("a", "skip"), swipe("b", "unsure")],
      }),
      WEEK,
    );
    assert.deepEqual([...ids], ["b"]);
  });

  test("取り消し済みの判断 → 0着（行が削除され、取得結果に含まれない）", () => {
    assert.equal(reviewedCount([], []), 0);
  });

  test("途中で終えたセッションの有効な判断 → 1着", () => {
    // セッションの完了状態は集計に関係しない（行があれば数える）
    assert.equal(reviewedCount([], [swipe("a", "let_go_candidate")]), 1);
  });

  test("残す・迷う・手放し候補はすべて見直しに数える", () => {
    assert.equal(
      reviewedCount(
        [],
        [swipe("a", "keep"), swipe("b", "unsure"), swipe("c", "let_go_candidate")],
      ),
      3,
    );
  });

  test("前の週の見直しは数えない", () => {
    assert.equal(reviewedCount([ai("a", LAST_WEEK)], [swipe("b", "keep", LAST_WEEK)]), 0);
  });

  test("履歴が0件 → 0着", () => {
    assert.equal(reviewedCount([], []), 0);
  });

  test("不正な日時の行は数えない", () => {
    assert.equal(reviewedCount([ai("a", "not-a-date")], []), 0);
  });
});

describe("着用記録の回数", () => {
  test("週内の記録回数を数える（同じ服でも1回ずつ）", () => {
    const logs = [
      { worn_at: IN_WEEK },
      { worn_at: IN_WEEK_2 },
      { worn_at: IN_WEEK_2 },
      { worn_at: LAST_WEEK },
    ];
    assert.equal(countWearLogs(logs, WEEK), 3);
  });

  test("履歴が0件 → 0回", () => {
    assert.equal(countWearLogs([], WEEK), 0);
  });

  test("着用回数は見直し着数・達成率に影響しない", () => {
    const progress = buildWeeklyProgress({
      reviewedItemCount: 1,
      wearLogCount: 20,
      goal: 3,
    });
    assert.equal(progress.reviewedItemCount, 1);
    assert.equal(progress.wearLogCount, 20);
    assert.equal(progress.achieved, false);
    assert.equal(progress.progressRate, 1 / 3);
  });
});

describe("週次目標と達成率", () => {
  test("目標3着: 0・2・3着", () => {
    assert.deepEqual(
      buildWeeklyProgress({ reviewedItemCount: 0, wearLogCount: 0, goal: 3 }),
      {
        reviewedItemCount: 0,
        wearLogCount: 0,
        goal: 3,
        progressRate: 0,
        achieved: false,
        remainingToGoal: 3,
      },
    );
    const two = buildWeeklyProgress({ reviewedItemCount: 2, wearLogCount: 0, goal: 3 });
    assert.equal(two.progressRate, 2 / 3);
    assert.equal(two.achieved, false);
    assert.equal(two.remainingToGoal, 1);
    const three = buildWeeklyProgress({ reviewedItemCount: 3, wearLogCount: 0, goal: 3 });
    assert.equal(three.progressRate, 1);
    assert.equal(three.achieved, true);
    assert.equal(three.remainingToGoal, 0);
  });

  test("目標7着: 5着は未達成", () => {
    const progress = buildWeeklyProgress({ reviewedItemCount: 5, wearLogCount: 0, goal: 7 });
    assert.equal(progress.progressRate, 5 / 7);
    assert.equal(progress.achieved, false);
    assert.equal(progress.remainingToGoal, 2);
  });

  test("目標14着: 14着で達成", () => {
    const progress = buildWeeklyProgress({ reviewedItemCount: 14, wearLogCount: 0, goal: 14 });
    assert.equal(progress.progressRate, 1);
    assert.equal(progress.achieved, true);
  });

  test("目標超過: 表示用の進捗率は100%が上限、着数はそのまま", () => {
    const progress = buildWeeklyProgress({ reviewedItemCount: 9, wearLogCount: 0, goal: 3 });
    assert.equal(progress.progressRate, 1);
    assert.equal(progress.reviewedItemCount, 9);
    assert.equal(progress.achieved, true);
    assert.equal(progress.remainingToGoal, 0);
  });

  test("目標なし: 達成率・達成判定・残り着数を持たない", () => {
    const progress = buildWeeklyProgress({ reviewedItemCount: 4, wearLogCount: 2, goal: null });
    assert.equal(progress.goal, null);
    assert.equal(progress.progressRate, null);
    assert.equal(progress.achieved, null);
    assert.equal(progress.remainingToGoal, null);
    assert.equal(progress.reviewedItemCount, 4);
    assert.equal(progress.wearLogCount, 2);
  });

  test("設定の読み取り: 行なし→3着、null→目標なし、選択肢→その値、不正値→3着", () => {
    assert.equal(resolveWeeklyReviewGoal(null), 3);
    assert.equal(resolveWeeklyReviewGoal(undefined), 3);
    assert.equal(resolveWeeklyReviewGoal({ weekly_review_goal: null }), null);
    assert.equal(resolveWeeklyReviewGoal({ weekly_review_goal: 3 }), 3);
    assert.equal(resolveWeeklyReviewGoal({ weekly_review_goal: 7 }), 7);
    assert.equal(resolveWeeklyReviewGoal({ weekly_review_goal: 14 }), 14);
    assert.equal(resolveWeeklyReviewGoal({ weekly_review_goal: 5 }), 3);
    assert.equal(resolveWeeklyReviewGoal({ weekly_review_goal: "7" }), 3);
  });
});
