import {
  MAX_PHOTO_BATCH_SIZE,
  type DiscardPhotoItemResult,
  type PhotoItemStage,
  type PhotoItemTarget,
} from "@/lib/photo-batch-registration";

// ============================================================
// 写真からまとめて登録する画面の状態の判定（純粋関数。テスト:
// node --test scripts/test-photo-batch-state.mts）
//
// 写真ごとの状態:
//   processing … 変換中（選んだ直後・回転の直後）
//   ready      … 変換済みで、登録を待っている
//   saving     … 保存中
//   saved      … 保存できた（以降は送らない・変えない）
//   failed     … 保存できなかった（target はそのまま。再試行も同じ target で送る）
// 変換に失敗した写真は一覧から外し、理由だけを表示する（登録できないため）
// ============================================================

export type PhotoBatchStatus = "processing" | "ready" | "saving" | "saved" | "failed";

export type PhotoBatchItemState = {
  status: PhotoBatchStatus;
  /** 保存先。最初の登録で決め、以降は変えない（未登録なら null） */
  target: PhotoItemTarget | null;
  /** 保存に失敗したときの内容（status が failed のとき） */
  failure: PhotoBatchFailure | null;
};

export type PhotoBatchFailure = {
  stage: PhotoItemStage;
  retryable: boolean;
  reason: "unknown" | "denied" | "invalid" | "conflict";
};

/** 追加で選んだ写真のうち、何枚まで加えられるか（合計 MAX_PHOTO_BATCH_SIZE 枚まで） */
export function planPhotoAddition(
  currentCount: number,
  incomingCount: number,
  max: number = MAX_PHOTO_BATCH_SIZE,
): { accept: number; rejected: number } {
  const accept = Math.max(0, Math.min(incomingCount, max - currentCount));
  return { accept, rejected: incomingCount - accept };
}

/**
 * 写真を外す・回転することができないか。
 * - 保存中・保存済みの写真
 * - 一度送った（target がある）写真。保存が途中まで進んでいる可能性があり、
 *   回転すると保存済みの画像と食い違い、外すと途中のデータが残るため
 *   （登録をやめる操作は Step 11-3 で、片付けと合わせて追加する）
 */
export function isPhotoLocked(item: PhotoBatchItemState): boolean {
  return item.status === "saving" || item.status === "saved" || item.target !== null;
}

/** 次の登録で送る写真（待機中と、再試行できる失敗） */
export function isPhotoToRegister(item: PhotoBatchItemState): boolean {
  return item.status === "ready" || (item.status === "failed" && item.failure?.retryable === true);
}

export function summarizePhotoBatch(items: readonly PhotoBatchItemState[]) {
  return {
    total: items.length,
    processing: items.filter((item) => item.status === "processing").length,
    saved: items.filter((item) => item.status === "saved").length,
    failed: items.filter((item) => item.status === "failed").length,
    toRegister: items.filter(isPhotoToRegister).length,
  };
}

/** 登録を始められるか（0枚・21枚以上・変換中・登録中は不可） */
export function canStartPhotoRegistration(
  items: readonly PhotoBatchItemState[],
  isRegistering: boolean,
): boolean {
  const summary = summarizePhotoBatch(items);
  return (
    !isRegistering &&
    summary.total > 0 &&
    summary.total <= MAX_PHOTO_BATCH_SIZE &&
    summary.processing === 0 &&
    summary.toRegister > 0
  );
}

/** 写真ごとの失敗の理由（再試行できるかどうかが分かる短い文） */
export function describePhotoFailure(failure: PhotoBatchFailure): string {
  if (failure.retryable) return "通信が不安定なため登録できませんでした。もう一度お試しください";
  switch (failure.reason) {
    case "denied":
      return "この写真は登録できませんでした（権限がありません）";
    case "conflict":
      return "同じ服のデータが別にあるため、登録を止めました";
    case "invalid":
      return failure.stage === "upload"
        ? "画像を保存できませんでした（形式または容量）"
        : "登録できない内容でした";
    default:
      return "登録できませんでした";
  }
}

/** 登録をやめる（片付けて一覧から外す）ことができるか。保存に失敗した写真だけ */
export function canDiscardPhoto(item: PhotoBatchItemState): boolean {
  return item.status === "failed" && item.target !== null;
}

/**
 * 片付け（discardIncompletePhotoItem）の結果に応じた画面の扱い。
 * - remove: 片付けられたので一覧から外す
 * - saved: 実は保存が完了していた。消さずに登録済みとして扱う
 * - keep: 消さずに残す（編集済み・確認できない・片付けに失敗）
 */
export function resolveDiscardResult(
  result: DiscardPhotoItemResult,
): { action: "remove" } | { action: "saved"; message: string } | { action: "keep"; message: string } {
  if (result.ok) return { action: "remove" };
  switch (result.reason) {
    case "completed":
      return { action: "saved", message: "この写真は登録が完了していたため、そのまま残しました" };
    case "edited":
      return {
        action: "keep",
        message: "別の画面で編集された服のため、取り消しませんでした。Closetで確認できます",
      };
    default:
      return {
        action: "keep",
        message: "取り消せませんでした。通信状態を確認して、もう一度お試しください",
      };
  }
}

/** 登録ボタンの文言（初回は「◯着を登録する」、失敗が残っていれば「残り◯着を登録する」） */
export function getPhotoRegisterButtonLabel(items: readonly PhotoBatchItemState[]): string {
  const { toRegister, saved, failed } = summarizePhotoBatch(items);
  const count = Math.max(toRegister, 1);
  return saved > 0 || failed > 0 ? `残り${count}着を登録する` : `${count}着を登録する`;
}

/** 画面を離れるときに確認するか（登録中、または登録していない写真が残っている） */
export function shouldConfirmPhotoBatchLeave(
  items: readonly PhotoBatchItemState[],
  isRegistering: boolean,
): boolean {
  return isRegistering || items.some((item) => item.status !== "saved");
}

const NORMAL_ENTRY_DRAFT_HINT = "残す場合は「通常登録」に戻って、下書きとして保存してください。";

/**
 * 写真からまとめて登録する画面で、離れる前に出す確認の文。
 * otherEntryDirty: 通常登録の画面（隠れている）に、保存していない入力がある
 */
export function getPhotoBatchLeaveMessage({
  items,
  isRegistering,
  otherEntryDirty,
}: {
  items: readonly PhotoBatchItemState[];
  isRegistering: boolean;
  otherEntryDirty: boolean;
}): string {
  const parts: string[] = [];
  if (isRegistering) {
    parts.push(
      "登録の途中です。移動すると、まだ保存していない写真は登録されず、写真のない服が残ることがあります（登録できた服は残ります）。",
    );
  } else if (items.some((item) => item.status === "failed")) {
    parts.push(
      "登録できなかった写真があります。移動すると、写真のない服などが残ることがあります。登録しない写真は「取り消す」で片付けてから移動してください。",
    );
  } else if (items.some((item) => item.status !== "saved")) {
    parts.push("このまま移動すると、選んだ写真は登録されません。");
  }
  if (otherEntryDirty) {
    parts.push(
      `${parts.length > 0 ? "通常登録で入力中の内容も保存されません。" : "通常登録で入力中の内容は保存されません。"}${NORMAL_ENTRY_DRAFT_HINT}`,
    );
  }
  return parts.join("");
}

/** 通常登録の画面で、写真だけ登録の画面（隠れている）に未登録の写真があるときに添える文 */
export const PHOTO_ENTRY_PENDING_NOTE =
  "「写真だけで登録」で選んだ写真（登録できなかった写真を含む）も登録されません。";

/**
 * 新規登録ページで、離脱の確認を担当する画面を1つに決める。
 * 隠れている画面の確認ダイアログは見えないため、表示中の画面だけが確認し、
 * もう一方の未保存の内容も含めて1回の確認で伝える。
 */
export function resolveEntryLeaveGuards({
  mode,
  normalDirty,
  photoPending,
}: {
  mode: "normal" | "photo";
  normalDirty: boolean;
  photoPending: boolean;
}): { normal: boolean; photo: boolean } {
  const anyPending = normalDirty || photoPending;
  return {
    normal: mode === "normal" && anyPending,
    photo: mode === "photo" && anyPending,
  };
}
