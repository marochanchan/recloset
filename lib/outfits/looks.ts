// 着画の一覧・編集まわりの純粋な関数。I/O はない。

export type LookRow = { id: string; worn_on: string; created_at: string };

/** worn_on の新しい順、同じ日は created_at の新しい順。元の配列は変えない。 */
export function sortLooks<T extends LookRow>(rows: readonly T[]): T[] {
  return [...rows].sort((p, q) => {
    if (p.worn_on !== q.worn_on) return p.worn_on > q.worn_on ? -1 : 1;
    if (p.created_at !== q.created_at) return p.created_at > q.created_at ? -1 : 1;
    return 0;
  });
}

export type PhotoRow = {
  outfit_id: string;
  provider_asset_id: string | null;
  sort_order: number;
  created_at: string;
};

/** 着画ごとの最初の写真（sort_order → created_at の順）の provider_asset_id。 */
export function firstPhotoByOutfit(rows: readonly PhotoRow[]): Map<string, string> {
  const best = new Map<string, PhotoRow>();
  for (const r of rows) {
    if (!r.provider_asset_id) continue;
    const cur = best.get(r.outfit_id);
    if (
      !cur ||
      r.sort_order < cur.sort_order ||
      (r.sort_order === cur.sort_order && r.created_at < cur.created_at)
    ) {
      best.set(r.outfit_id, r);
    }
  }
  return new Map([...best].map(([id, r]) => [id, r.provider_asset_id as string]));
}

/** 服の一覧の差分。順番だけの違いは変更とみなさない。 */
export function diffItemIds(before: readonly string[], after: readonly string[]) {
  const b = new Set(before);
  const a = new Set(after);
  const added = [...a].filter((id) => !b.has(id));
  const removed = [...b].filter((id) => !a.has(id));
  return { added, removed, changed: added.length > 0 || removed.length > 0 };
}
