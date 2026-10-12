// ============================================================
// 週次目標の達成演出の「表示済み」管理（純粋関数。DB・UIに依存しない）
//
// - 達成したかどうかはサーバー側の実績（WeeklyProgress.achieved）で決まる。
//   ここで扱うのは「同じブラウザ・同じ週にお祝いを何度も出さない」ことだけ
// - 表示済みの週（週の初日の日付 YYYY-MM-DD）を1つだけ保存する。
//   週が変われば値が一致しなくなり、再び表示できる
// - 目標を週の途中で変えても、同じ週には2回目のお祝いを出さない
//   （キーは週だけで、目標の値を含めない）
// - localStorage が使えない（プライベートモード・容量超過・アクセス拒否など）
//   場合は、毎回お祝いが出続けないよう、演出を出さない（達成の文言は別に表示される）
// Node.jsから直接テストできるよう、他のモジュールをimportしない
// （テスト: node --test scripts/test-weekly-celebration.mts）
// ============================================================

export const WEEKLY_GOAL_CELEBRATION_STORAGE_KEY = "recloset:weekly-goal-celebrated-week";

/** localStorage のうち使う部分だけ（テストで差し替えられるようにする） */
export type CelebrationStorage = Pick<Storage, "getItem" | "setItem">;

/**
 * 今回お祝いを表示するかを決め、表示する場合は表示済みとして記録する。
 * - achieved が true でなければ表示しない（未達成・目標なし・目標の取得失敗）
 * - 同じ週に表示済みなら表示しない
 * - storage が使えない・読み書きに失敗した場合は表示しない
 */
export function claimWeeklyGoalCelebration({
  achieved,
  weekStartDateKey,
  storage,
}: {
  achieved: boolean | null;
  weekStartDateKey: string;
  storage: CelebrationStorage | null;
}): boolean {
  if (achieved !== true || !weekStartDateKey || !storage) return false;
  try {
    if (storage.getItem(WEEKLY_GOAL_CELEBRATION_STORAGE_KEY) === weekStartDateKey) {
      return false;
    }
    storage.setItem(WEEKLY_GOAL_CELEBRATION_STORAGE_KEY, weekStartDateKey);
    return true;
  } catch {
    return false;
  }
}

/** ブラウザの localStorage を取得する（アクセス自体が例外になる環境ではnull） */
export function getBrowserStorage(): CelebrationStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/**
 * 演出のクラス。動きは motion-safe（OSで「視差効果を減らす」を選んでいない場合）だけに付け、
 * prefers-reduced-motion: reduce の環境では動かさず、表示だけにする
 */
export const WEEKLY_GOAL_CELEBRATION_MOTION_CLASS =
  "motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-95 motion-safe:duration-500";
