// 類似判定の試験：ネットワークに触れない純粋な関数だけをここに置く（テスト対象）。

import { createHash } from "node:crypto";

export type Tags = {
  category: string | null;
  subcategory: string | null;
  main_color: string | null;
  pattern: string | null;
  material_look: string | null;
  sleeve_length: string | null;
  layer_role: string | null;
};

export const TAG_KEYS = [
  "category",
  "subcategory",
  "main_color",
  "pattern",
  "material_look",
  "sleeve_length",
  "layer_role",
] as const satisfies readonly (keyof Tags)[];

export const SCORE_WEIGHTS: Record<(typeof TAG_KEYS)[number], number> = {
  category: 3,
  subcategory: 3,
  main_color: 2,
  pattern: 1,
  material_look: 1,
  sleeve_length: 1,
  layer_role: 1,
};

// ---- 単価（USD / 100万トークン。レポートの値） ----
export const PRICES: Record<string, { input: number; output: number }> = {
  "google/gemini-3.5-flash-lite": { input: 0.3, output: 2.5 },
  "google/gemini-3.8-flash": { input: 0.75, output: 3.75 },
};
export const EMBEDDING_PRICE_PER_IMAGE = 0.00012; // google/gemini-embedding-2

export function tokenCost(model: string, inputTokens: number, outputTokens: number): number {
  const p = PRICES[model];
  if (!p) return 0;
  return (inputTokens * p.input + outputTokens * p.output) / 1_000_000;
}

export function embeddingCost(images: number): number {
  return images * EMBEDDING_PRICE_PER_IMAGE;
}

// ---- タグだけの順位 ----
export function scoreTags(det: Tags, flat: Tags): number {
  let s = 0;
  for (const k of TAG_KEYS) {
    if (det[k] !== null && det[k] === flat[k]) s += SCORE_WEIGHTS[k];
  }
  return s;
}

export function rankByTags(det: Tags, flats: { id: string; tags: Tags }[]): string[] {
  return flats
    .map((f) => ({ id: f.id, score: scoreTags(det, f.tags) }))
    .sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((f) => f.id);
}

/** AIの並び（候補の1始まりの番号）→ 残りはタグの順。不正な番号・重複は無視する。 */
export function mergeRanking(aiRanking: number[], candidateIds: string[], tagOrder: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const n of aiRanking) {
    if (!Number.isInteger(n) || n < 1 || n > candidateIds.length) continue;
    const id = candidateIds[n - 1];
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  for (const id of tagOrder) {
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

// ---- 切り抜き ----
export type CropRegion = { left: number; top: number; width: number; height: number };

/** box_2d = [ymin, xmin, ymax, xmax]（0〜1000）。周りに margin の余白を足し、画像の端で切る。 */
export function cropRegion(box: unknown, width: number, height: number, margin = 0.1): CropRegion | null {
  if (!Array.isArray(box) || box.length !== 4) return null;
  if (!box.every((v) => typeof v === "number" && Number.isFinite(v))) return null;
  const [ymin, xmin, ymax, xmax] = box as number[];
  if (ymax <= ymin || xmax <= xmin) return null;
  const clamp = (v: number) => Math.min(1000, Math.max(0, v));
  const y0 = (clamp(ymin) / 1000) * height;
  const y1 = (clamp(ymax) / 1000) * height;
  const x0 = (clamp(xmin) / 1000) * width;
  const x1 = (clamp(xmax) / 1000) * width;
  const my = (y1 - y0) * margin;
  const mx = (x1 - x0) * margin;
  const left = Math.max(0, Math.floor(x0 - mx));
  const top = Math.max(0, Math.floor(y0 - my));
  const right = Math.min(width, Math.ceil(x1 + mx));
  const bottom = Math.min(height, Math.ceil(y1 + my));
  if (right - left < 1 || bottom - top < 1) return null;
  return { left, top, width: right - left, height: bottom - top };
}

// ---- キャッシュのキー ----
export function cacheKey(p: { stage: string; model: string; inputHash: string; config: string }): string {
  return createHash("sha256").update(JSON.stringify([p.stage, p.model, p.inputHash, p.config])).digest("hex");
}

export function sha256(data: Uint8Array | string): string {
  return createHash("sha256").update(data).digest("hex");
}

// ---- 正解表 ----
export type TruthEntry = { items: string[]; similar?: string[]; hidden?: string[] };
export type Truth = { looks: Record<string, TruthEntry> };

export function validateTruth(truth: unknown, flatIds: Set<string>): asserts truth is Truth {
  const looks = (truth as { looks?: unknown } | null)?.looks;
  if (!looks || typeof looks !== "object") throw new Error("truth.json: looks がありません");
  for (const [name, e] of Object.entries(looks as Record<string, TruthEntry>)) {
    if (!e || !Array.isArray(e.items)) throw new Error(`truth.json: ${name} に items がありません`);
    for (const id of e.items) {
      if (!flatIds.has(id)) throw new Error(`truth.json: ${name} の items の ${id} が flats にありません`);
    }
    for (const key of ["similar", "hidden"] as const) {
      for (const id of e[key] ?? []) {
        if (!e.items.includes(id)) throw new Error(`truth.json: ${name} の ${key} の ${id} が items にありません`);
      }
    }
  }
}

// ---- 採点 ----
export type ItemScore = { id: string; detected: boolean; rank: number | null; similar: boolean; hidden: boolean };

/** 全検出の順位表のうち、id を一番上に置いた順位（1始まり）。どこにもなければ null。 */
export function rankOfItem(rankings: string[][], id: string): number | null {
  let best: number | null = null;
  for (const r of rankings) {
    const i = r.indexOf(id);
    if (i >= 0 && (best === null || i + 1 < best)) best = i + 1;
  }
  return best;
}

export function scoreLook(
  entry: TruthEntry,
  categoryOf: (id: string) => string | null | undefined,
  detections: { category: string | null }[],
  rankings: string[][],
): ItemScore[] {
  // 検出の割合：category ごとに、正解の着数と検出の数のうち小さい方まで数える
  const available = new Map<string, number>();
  for (const d of detections) {
    if (d.category) available.set(d.category, (available.get(d.category) ?? 0) + 1);
  }
  return entry.items.map((id) => {
    const cat = categoryOf(id);
    let detected = false;
    if (cat && (available.get(cat) ?? 0) > 0) {
      available.set(cat, (available.get(cat) ?? 0) - 1);
      detected = true;
    }
    return {
      id,
      detected,
      rank: rankOfItem(rankings, id),
      similar: entry.similar?.includes(id) ?? false,
      hidden: entry.hidden?.includes(id) ?? false,
    };
  });
}

export type Aggregate = {
  n: number;
  detected: number;
  top1: number;
  top3: number;
  similar: { n: number; top1: number; top3: number };
  hidden: { n: number; top1: number; top3: number };
};

export function aggregateScores(items: ItemScore[]): Aggregate {
  const a: Aggregate = {
    n: items.length,
    detected: 0,
    top1: 0,
    top3: 0,
    similar: { n: 0, top1: 0, top3: 0 },
    hidden: { n: 0, top1: 0, top3: 0 },
  };
  for (const it of items) {
    const t1 = it.rank !== null && it.rank <= 1;
    const t3 = it.rank !== null && it.rank <= 3;
    if (it.detected) a.detected++;
    if (t1) a.top1++;
    if (t3) a.top3++;
    for (const k of ["similar", "hidden"] as const) {
      if (it[k]) {
        a[k].n++;
        if (t1) a[k].top1++;
        if (t3) a[k].top3++;
      }
    }
  }
  return a;
}

// ---- summary.md ----
export type VariantRow = {
  method: string;
  detectModel: string;
  size: string;
  agg: Aggregate;
  looks: number;
  costUsd: number; // 全着画の合計
  ms: number; // 全着画の合計
};

const pct = (k: number, n: number) => (n === 0 ? "-" : `${((k / n) * 100).toFixed(0)}% (${k}/${n})`);

export function renderSummary(rows: VariantRow[], notes: string[]): string {
  const lines = [
    "# 類似判定の試験結果",
    "",
    "上位1件・上位3件は「正解の服ごと、その着画で検出した服のうち一番上に置いた順位」。分母は正解の服の数。",
    "",
    "| 方式 | 検出モデル | 画像 | 検出の割合 | 上位1件 | 上位3件 | 似た服だけ(上位3件) | 隠れた服だけ(上位3件) | 費用/着画 | 時間/着画 |",
    "|---|---|---|---|---|---|---|---|---|---|",
  ];
  for (const r of rows) {
    const l = Math.max(1, r.looks);
    lines.push(
      `| ${r.method} | ${r.detectModel.replace("google/", "")} | ${r.size} | ${pct(r.agg.detected, r.agg.n)} | ${pct(r.agg.top1, r.agg.n)} | ${pct(r.agg.top3, r.agg.n)} | ${pct(r.agg.similar.top3, r.agg.similar.n)} | ${pct(r.agg.hidden.top3, r.agg.hidden.n)} | $${(r.costUsd / l).toFixed(4)} | ${(r.ms / l / 1000).toFixed(1)}秒 |`,
    );
  }
  if (notes.length) lines.push("", "## メモ", "", ...notes.map((n) => `- ${n}`));
  lines.push("");
  return lines.join("\n");
}
