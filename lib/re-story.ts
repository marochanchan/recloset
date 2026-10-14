// ============================================================
// Re:Story（月ごとの振り返り。純粋関数。DB・UI・AIに依存しない）
//
// - 材料は行動履歴（closet_activity_events、migration 019）だけ
// - 日付・月は日本時間（Asia/Tokyo, 常にUTC+9・サマータイムなし）
// - 取り消し済み（revoked_at がある）行動は、表示にも集計にも使わない
// - 服を削除しても行動は残る（服は null。表示は「削除した服」）
// - 服の名前は今の名前（行動したときの名前は記録されていない）
// - 活動日数と行動回数を分ける:
//   - 活動日数: その種類の行動をした日の数（同じ日に何回しても1日）
//   - 月全体の活動日数: 種類をまたいでも同じ日は1日
//   - 見直した着数: 同じ日・同じ服は1着
// - Re:Garden のポイントとは見せ方を分ける（こちらは月ごとの日数・回数）
// 表示の文言は lib/re-story-copy.ts
// ============================================================

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** 1か月に読む行動の上限。これを超える月は、数え漏れを避けるため読み込みエラーにする */
export const STORY_MONTH_EVENTS_LIMIT = 1000;

export const STORY_KINDS = [
  "register",
  "wear",
  "review",
  "organize",
  "circulate",
] as const;

export type StoryKind = (typeof STORY_KINDS)[number];

export const STORY_ACTIONS = [
  "item_registered",
  "wear_logged",
  "ai_diagnosis",
  "swipe_review",
  "category_classified",
  "seasons_classified",
  "status_candidate",
  "status_letting_go",
  "status_sold",
] as const;

export type StoryAction = (typeof STORY_ACTIONS)[number];

export function isStoryKind(value: unknown): value is StoryKind {
  return (STORY_KINDS as readonly unknown[]).includes(value);
}

export function isStoryAction(value: unknown): value is StoryAction {
  return (STORY_ACTIONS as readonly unknown[]).includes(value);
}

/** 振り返りに使う1件の行動（DBの行から必要な情報だけにしたもの） */
export type StoryEvent = {
  id: string;
  kind: StoryKind;
  action: StoryAction;
  /** 対象の服。削除済みならnull */
  clothingItemId: string | null;
  /** 服の今の名前。削除済み・取得できないならnull */
  itemTitle: string | null;
  occurredAt: string;
  revokedAt: string | null;
};

// ------------------------------------------------------------
// 月（日本時間）
// ------------------------------------------------------------

const MONTH_KEY_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** "YYYY-MM" の形で、実在する月なら true */
export function isMonthKey(value: unknown): value is string {
  return typeof value === "string" && MONTH_KEY_PATTERN.test(value);
}

/** 日時が属する日本時間の月（YYYY-MM） */
export function getJstMonthKey(date: Date): string {
  return new Date(date.getTime() + JST_OFFSET_MS).toISOString().slice(0, 7);
}

/** ISO時刻の日本時間の日付（YYYY-MM-DD）。不正な値はnull */
export function getJstDateKey(isoString: string): string | null {
  const time = new Date(isoString).getTime();
  if (Number.isNaN(time)) return null;
  return new Date(time + JST_OFFSET_MS).toISOString().slice(0, 10);
}

/** 月の範囲（日本時間の1日0:00〜翌月1日0:00）をUTCで返す。開始を含み、終了を含まない */
export function getJstMonthRangeUtc(monthKey: string): { startUtc: Date; endUtc: Date } {
  const [year, month] = monthKey.split("-").map(Number);
  return {
    startUtc: new Date(Date.UTC(year, month - 1, 1) - JST_OFFSET_MS),
    endUtc: new Date(Date.UTC(year, month, 1) - JST_OFFSET_MS),
  };
}

/** 月をずらす（delta: 前月は -1、翌月は +1） */
export function shiftMonthKey(monthKey: string, delta: number): string {
  const [year, month] = monthKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1 + delta, 1)).toISOString().slice(0, 7);
}

export type StoryMonthNav = {
  /** 表示する月（YYYY-MM） */
  monthKey: string;
  /** 前の月。最初の行動の月より前には戻れない（なければnull） */
  prevMonthKey: string | null;
  /** 次の月。今月より先には進めない（なければnull） */
  nextMonthKey: string | null;
};

/**
 * URLの month から表示する月を決める。
 * - 不正な値・未指定・未来の月: 今月
 * - 最初の行動の月より前: 最初の行動の月
 * - 行動が1件もない（firstMonthKey が null）: 今月だけ（前後に移動しない）
 */
export function resolveStoryMonth({
  requested,
  now,
  firstMonthKey,
}: {
  requested: unknown;
  now: Date;
  firstMonthKey: string | null;
}): StoryMonthNav {
  const currentMonthKey = getJstMonthKey(now);
  const earliest =
    firstMonthKey && isMonthKey(firstMonthKey) && firstMonthKey < currentMonthKey
      ? firstMonthKey
      : currentMonthKey;

  let monthKey = isMonthKey(requested) ? requested : currentMonthKey;
  if (monthKey > currentMonthKey) monthKey = currentMonthKey;
  if (monthKey < earliest) monthKey = earliest;

  return {
    monthKey,
    prevMonthKey: monthKey > earliest ? shiftMonthKey(monthKey, -1) : null,
    nextMonthKey: monthKey < currentMonthKey ? shiftMonthKey(monthKey, 1) : null,
  };
}

/**
 * 019 の適用前の記録が欠けているかもしれない月か。
 * trackingSince は、その人の行動履歴が作られた時刻（初期作成の行の created_at
 * ＝本番で 019 を適用した時刻）。初期作成の行がない人は null（欠落なし）
 */
export function isMonthBeforeTracking(
  monthKey: string,
  trackingSince: string | null,
): boolean {
  if (!trackingSince) return false;
  const since = new Date(trackingSince).getTime();
  if (Number.isNaN(since)) return false;
  return getJstMonthRangeUtc(monthKey).startUtc.getTime() < since;
}

// ------------------------------------------------------------
// 取得結果の判定（1000件の上限）
// ------------------------------------------------------------

/**
 * その月の行動の取得結果を判定する。
 * - 1001件目まで要求して、1001件以上返れば上限超過
 * - Data API の1回の最大件数（既定1000件）で切られた可能性があるときは、
 *   正確な件数（exactCount）で判定する。件数が分からなければ超過とみなす
 */
export function resolveMonthEventsLimit({
  rowCount,
  exactCount,
}: {
  rowCount: number;
  /** 行数が上限に届いたときだけ取得する正確な件数（取れなければnull） */
  exactCount: number | null;
}): "ok" | "over_limit" {
  if (rowCount > STORY_MONTH_EVENTS_LIMIT) return "over_limit";
  if (rowCount < STORY_MONTH_EVENTS_LIMIT) return "ok";
  if (exactCount === null) return "over_limit";
  return exactCount > STORY_MONTH_EVENTS_LIMIT ? "over_limit" : "ok";
}

// ------------------------------------------------------------
// 月のまとめ
// ------------------------------------------------------------

/** 取り消し済みを除き、不正な時刻のものも除いた行動 */
export function getEffectiveEvents(events: StoryEvent[]): StoryEvent[] {
  return events.filter(
    (event) => event.revokedAt === null && getJstDateKey(event.occurredAt) !== null,
  );
}

export type StoryMonthSummary = {
  /** 何か1つでも行動した日数（種類をまたいでも同じ日は1日） */
  activeDays: number;
  /** 種類ごとの活動日数 */
  daysByKind: Record<StoryKind, number>;
  /** 登録した着数 */
  registeredItemCount: number;
  /** 着用の記録回数 */
  wearCount: number;
  /** 見直した着数（同じ日・同じ服は1着。削除した服は行動ごとに1着） */
  reviewedItemCount: number;
  /** 整理の回数（仕分け・手放し候補） */
  organizeCount: number;
  /** 循環の回数（出品中・売却済み） */
  circulateCount: number;
  /** 行動の合計回数 */
  totalEvents: number;
};

/** 月の行動のまとめ（渡された行動は、その月の範囲のものだけである前提） */
export function summarizeStoryMonth(events: StoryEvent[]): StoryMonthSummary {
  const effective = getEffectiveEvents(events);
  const activeDates = new Set<string>();
  const datesByKind = Object.fromEntries(
    STORY_KINDS.map((kind) => [kind, new Set<string>()]),
  ) as Record<StoryKind, Set<string>>;
  const registeredItems = new Set<string>();
  const reviewedKeys = new Set<string>();
  let wearCount = 0;
  let organizeCount = 0;
  let circulateCount = 0;

  for (const event of effective) {
    const dateKey = getJstDateKey(event.occurredAt) as string;
    activeDates.add(dateKey);
    datesByKind[event.kind].add(dateKey);
    // 削除した服（null）は同じ服か分からないため、行動ごとに別の服として数える
    const itemKey = event.clothingItemId ?? `deleted:${event.id}`;
    switch (event.kind) {
      case "register":
        registeredItems.add(itemKey);
        break;
      case "wear":
        wearCount++;
        break;
      case "review":
        reviewedKeys.add(`${dateKey}:${itemKey}`);
        break;
      case "organize":
        organizeCount++;
        break;
      case "circulate":
        circulateCount++;
        break;
    }
  }

  return {
    activeDays: activeDates.size,
    daysByKind: Object.fromEntries(
      STORY_KINDS.map((kind) => [kind, datesByKind[kind].size]),
    ) as Record<StoryKind, number>,
    registeredItemCount: registeredItems.size,
    wearCount,
    reviewedItemCount: reviewedKeys.size,
    organizeCount,
    circulateCount,
    totalEvents: effective.length,
  };
}

// ------------------------------------------------------------
// タイムライン（日付 × 具体的な行動でまとめる）
// ------------------------------------------------------------

export type StoryTimelineGroup = {
  action: StoryAction;
  kind: StoryKind;
  /** 行動の回数 */
  eventCount: number;
  /** 対象の服の数（同じ服は1着。削除した服は行動ごとに1着） */
  itemCount: number;
  /** 名前の分かる服（重複なし、新しい順。写真だけ登録した仮の名前は含めない） */
  namedItems: { id: string; title: string }[];
  /** 写真だけ登録した仮の名前のままの服の数 */
  photoOnlyItemCount: number;
  /** 削除した服の数 */
  deletedItemCount: number;
};

export type StoryTimelineDay = {
  /** 日本時間の日付（YYYY-MM-DD） */
  dateKey: string;
  groups: StoryTimelineGroup[];
};

/**
 * 行動を「日付 × 具体的な行動」でまとめる。
 * 日付は新しい順、1日の中は最後にその行動をした時刻が新しい順。
 * 服の名前は新しい行動の順に並べる
 */
export function buildStoryTimeline(
  events: StoryEvent[],
  photoOnlyTitle: string,
): StoryTimelineDay[] {
  const effective = [...getEffectiveEvents(events)].sort((a, b) => {
    const diff = new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime();
    if (diff !== 0) return diff;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  const days = new Map<string, Map<StoryAction, StoryTimelineGroup>>();
  // まとめた行ごとの、数えた服のID（同じ服を二重に数えない）
  const itemKeysByGroup = new Map<StoryTimelineGroup, Set<string>>();

  for (const event of effective) {
    const dateKey = getJstDateKey(event.occurredAt) as string;
    const groups = days.get(dateKey) ?? new Map<StoryAction, StoryTimelineGroup>();
    days.set(dateKey, groups);
    let group = groups.get(event.action);
    if (!group) {
      group = {
        action: event.action,
        kind: event.kind,
        eventCount: 0,
        itemCount: 0,
        namedItems: [],
        photoOnlyItemCount: 0,
        deletedItemCount: 0,
      };
      groups.set(event.action, group);
      itemKeysByGroup.set(group, new Set<string>());
    }
    group.eventCount++;

    if (event.clothingItemId === null) {
      // 削除した服は同じ服か分からないため、行動ごとに1着
      group.deletedItemCount++;
      group.itemCount++;
      continue;
    }
    const itemKeys = itemKeysByGroup.get(group) as Set<string>;
    if (itemKeys.has(event.clothingItemId)) continue;
    itemKeys.add(event.clothingItemId);
    group.itemCount++;
    if (event.itemTitle === null) {
      group.deletedItemCount++;
    } else if (event.itemTitle === photoOnlyTitle) {
      group.photoOnlyItemCount++;
    } else {
      group.namedItems.push({ id: event.clothingItemId, title: event.itemTitle });
    }
  }

  // Map は挿入順を保つ（新しい行動から入れたため、日付・行動とも新しい順になる）
  return [...days.entries()].map(([dateKey, groups]) => ({
    dateKey,
    groups: [...groups.values()],
  }));
}
