import { GARDEN_KIND_LABELS } from "@/lib/garden-copy";
import type {
  StoryAction,
  StoryKind,
  StoryMonthSummary,
  StoryTimelineGroup,
} from "@/lib/re-story";

// ============================================================
// Re:Story の表示文言（集計は lib/re-story.ts）
// - 落ち着いた、押し付けがましくない言葉。記録のない月・少ない月を否定しない
// - 手放した数を成果として強調しない（どの行動も同じように振り返る）
// ============================================================

export const RE_STORY_TITLE = "Re:Story";

export const RE_STORY_LEAD = "服との日々を、月ごとに振り返ります。";

export const RE_STORY_LOAD_ERROR_MESSAGE = "記録を読み込めませんでした。時間をおいてお試しください。";

export const RE_STORY_OVER_LIMIT_MESSAGE =
  "この月は記録がとても多いため、振り返りを表示できませんでした。";

export const RE_STORY_EMPTY_MONTH_MESSAGE = "この月の記録はまだありません。";

export const RE_STORY_NO_EVENTS_MESSAGE =
  "服を登録したり、着た日を記録したりすると、ここに少しずつ物語がたまっていきます。";

/** 019 適用前の月への注記（状態の変更・季節の仕分けは、当時の記録が残っていない） */
export const RE_STORY_TRACKING_NOTE =
  "この頃の「手放し候補・出品・売却」と「季節の仕分け」は、記録が残っていないことがあります。";

export const DELETED_ITEM_LABEL = "削除した服";

/** 種類の名前（Re:Garden と同じ呼び方にそろえる） */
export const STORY_KIND_LABELS: Record<StoryKind, string> = GARDEN_KIND_LABELS;

/** 行動の文（n は対象の服の数。着用だけは記録の回数） */
export function getStoryActionSentence(group: StoryTimelineGroup): string {
  const n = group.itemCount;
  const sentences: Record<StoryAction, string> = {
    item_registered: `服を${n}着登録しました`,
    wear_logged: `着た服を${group.eventCount}回記録しました`,
    ai_diagnosis: `AIと一緒に${n}着を見直しました`,
    swipe_review: `${n}着をまとめて見直しました`,
    category_classified: `${n}着のカテゴリを仕分けました`,
    seasons_classified: `${n}着の季節を仕分けました`,
    status_candidate: `${n}着を手放し候補にしました`,
    status_letting_go: `${n}着を出品しました`,
    status_sold: `${n}着が新しい持ち主のもとへ旅立ちました`,
  };
  return sentences[group.action];
}

/** 名前を出す服の数（多いときは「ほか○着」にまとめる） */
const MAX_NAMED_ITEMS = 2;

/**
 * 対象の服の説明（例: 「ニット、シャツ ほか1着・写真から登録した服3着・削除した服1着」）。
 * 名前の分かる服を先に、最大2着まで。対象の服がなければnull
 */
export function getStoryItemsDescription(
  group: StoryTimelineGroup,
  photoOnlyTitle: string,
): string | null {
  const parts: string[] = [];
  const shown = group.namedItems.slice(0, MAX_NAMED_ITEMS).map((item) => item.title);
  const hiddenNamed = group.namedItems.length - shown.length;
  if (shown.length > 0) {
    parts.push(hiddenNamed > 0 ? `${shown.join("、")} ほか${hiddenNamed}着` : shown.join("、"));
  }
  if (group.photoOnlyItemCount > 0) {
    parts.push(
      group.photoOnlyItemCount === 1
        ? photoOnlyTitle
        : `${photoOnlyTitle}${group.photoOnlyItemCount}着`,
    );
  }
  if (group.deletedItemCount > 0) {
    parts.push(
      group.deletedItemCount === 1
        ? DELETED_ITEM_LABEL
        : `${DELETED_ITEM_LABEL}${group.deletedItemCount}着`,
    );
  }
  return parts.length > 0 ? parts.join("・") : null;
}

// 同じ日数のときに、ひとことで取り上げる順（手放しを先にしない）
const HIGHLIGHT_ORDER: StoryKind[] = ["wear", "review", "organize", "register", "circulate"];

const KIND_HIGHLIGHT_MESSAGES: Record<StoryKind, string> = {
  register: "新しく迎えた服を、記録に残せた月でした。",
  wear: "着た日の記録が、いちばん多い月でした。",
  review: "服と向き合って見直す時間が、いちばん多い月でした。",
  organize: "クローゼットを整える時間が、いちばん多い月でした。",
  circulate: "服を次へつなぐ動きが、いちばん多い月でした。",
};

/** 月のひとこと（ルールベース。記録がない月も責めない） */
export function getStoryMonthMessage(summary: StoryMonthSummary): string {
  if (summary.activeDays === 0) return RE_STORY_EMPTY_MONTH_MESSAGE;
  const base = `この月は${summary.activeDays}日、服と向き合いました。`;
  const usedKinds = HIGHLIGHT_ORDER.filter((kind) => summary.daysByKind[kind] > 0);
  if (usedKinds.length >= 3) {
    return `${base}いろいろな形で、服と関わった月でした。`;
  }
  const top = usedKinds.reduce((best, kind) =>
    summary.daysByKind[kind] > summary.daysByKind[best] ? kind : best,
  );
  return `${base}${KIND_HIGHLIGHT_MESSAGES[top]}`;
}

/** 月の見出し（例: 2026年10月） */
export function formatStoryMonth(monthKey: string): string {
  const [year, month] = monthKey.split("-").map(Number);
  return `${year}年${month}月`;
}

const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"] as const;

/** 日付の見出し（例: 10月14日（水）） */
export function formatStoryDate(dateKey: string): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const weekday = WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()];
  return `${month}月${day}日（${weekday}）`;
}
