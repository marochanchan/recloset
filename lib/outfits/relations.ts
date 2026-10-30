// 服どうしの「つながり」（よく合わせる服）の計算。I/O のない純粋な関数だけを置く。
// item_pair_monthly_stats の行（item_a < item_b）から相手ごとの回数を出し、放射状の線の位置を決める。

export type PairMonthRow = {
  item_a: string;
  item_b: string;
  month: string;
  outfit_count: number;
  together_days: number;
  last_worn_on: string | null;
};

export type Partner = {
  itemId: string;
  outfitCount: number;
  lastWornOn: string | null;
};

export type RadialLine = {
  itemId: string;
  x: number;
  y: number;
  nodeRadius: number;
  strokeWidth: number;
};

/**
 * itemId の相手ごとに outfit_count を足し、last_worn_on は最大（最新）を取る。
 * item_a / item_b のどちらに itemId がいても相手として数える。
 * 並び順：回数の多い順 → 最後に着た日の新しい順（null は最後）→ itemId の昇順。
 */
export function aggregatePartners(rows: readonly PairMonthRow[], itemId: string): Partner[] {
  const byPartner = new Map<string, Partner>();
  for (const r of rows) {
    let partnerId: string;
    if (r.item_a === itemId) partnerId = r.item_b;
    else if (r.item_b === itemId) partnerId = r.item_a;
    else continue;
    const cur = byPartner.get(partnerId) ?? { itemId: partnerId, outfitCount: 0, lastWornOn: null };
    cur.outfitCount += r.outfit_count;
    // YYYY-MM-DD は文字列の比較がそのまま日付の比較になる
    if (r.last_worn_on !== null && (cur.lastWornOn === null || r.last_worn_on > cur.lastWornOn)) {
      cur.lastWornOn = r.last_worn_on;
    }
    byPartner.set(partnerId, cur);
  }
  return [...byPartner.values()].sort((p, q) => {
    if (p.outfitCount !== q.outfitCount) return q.outfitCount - p.outfitCount;
    if (p.lastWornOn !== q.lastWornOn) {
      if (p.lastWornOn === null) return 1;
      if (q.lastWornOn === null) return -1;
      return p.lastWornOn > q.lastWornOn ? -1 : 1;
    }
    return p.itemId < q.itemId ? -1 : p.itemId > q.itemId ? 1 : 0;
  });
}

const NODE_RADIUS_MIN = 12;
const NODE_RADIUS_MAX = 24;
const STROKE_WIDTH_MIN = 1;
const STROKE_WIDTH_MAX = 6;

// 小数第2位に丸める（テストで厳密に比較できるように）。-0 は 0 にそろえる。
function round2(n: number): number {
  return Math.round(n * 100) / 100 + 0;
}

/**
 * 先頭から max 件（超えた分は捨てる）を、真上（-90°）から時計回りに等間隔で並べる。
 * 座標は中心が原点、y は下向きが正（SVG と同じ）で、小数第2位に丸める。
 * 距離：表示する相手の中で回数が最大なら innerRadius、最小なら outerRadius、間は線形。
 * nodeRadius（12〜24）と strokeWidth（1〜6）は回数に比例して、最小〜最大の間を線形に動く。
 * 全員同じ回数のときは、距離は innerRadius、大きさは最大にする。
 */
export function layoutRadialLines(
  partners: readonly Partner[],
  opts: { max: number; innerRadius: number; outerRadius: number },
): RadialLine[] {
  const shown = partners.slice(0, Math.max(0, opts.max));
  if (shown.length === 0) return [];
  const counts = shown.map((p) => p.outfitCount);
  const maxCount = Math.max(...counts);
  const minCount = Math.min(...counts);
  const span = maxCount - minCount;

  return shown.map((p, i) => {
    // 多いほど 1、少ないほど 0。全員同じなら 1（最大のサイズ・内側）
    const strength = span === 0 ? 1 : (p.outfitCount - minCount) / span;
    const radius = opts.innerRadius + (opts.outerRadius - opts.innerRadius) * (1 - strength);
    const angle = -Math.PI / 2 + (2 * Math.PI * i) / shown.length;
    return {
      itemId: p.itemId,
      x: round2(radius * Math.cos(angle)),
      y: round2(radius * Math.sin(angle)),
      nodeRadius: round2(NODE_RADIUS_MIN + (NODE_RADIUS_MAX - NODE_RADIUS_MIN) * strength),
      strokeWidth: round2(STROKE_WIDTH_MIN + (STROKE_WIDTH_MAX - STROKE_WIDTH_MIN) * strength),
    };
  });
}
