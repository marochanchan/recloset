// 類似判定の試験の本体。使い方は scripts/similarity-trial/README.md。
//
//   node --env-file=.env.local scripts/similarity-trial/run.mts [--dry-run] [--yes] [--skip-embedding] [--data-dir <dir>]
//
// --dry-run：AI を呼ばない偽のモデルで全段階を通す（ネットワークにも .env.local にも触れない）。

import { cosineSimilarity, embed, generateText, Output } from "ai";
import { MockEmbeddingModelV4, MockLanguageModelV4 } from "ai/test";
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import sharp from "sharp";
import { z } from "zod";
import { analyzeClothingImage, ClothingImageAnalysisSchema } from "../../lib/clothing-image-analysis.ts";
import {
  aggregateScores,
  cacheKey,
  cropRegion,
  embeddingCost,
  mergeRanking,
  rankByTags,
  renderSummary,
  scoreLook,
  sha256,
  tokenCost,
  validateTruth,
  type ItemScore,
  type Tags,
  type VariantRow,
} from "./core.ts";

const { values: args } = parseArgs({
  options: {
    "dry-run": { type: "boolean", default: false },
    yes: { type: "boolean", default: false },
    "skip-embedding": { type: "boolean", default: false },
    "data-dir": { type: "string", default: ".superpowers/similarity-trial" },
  },
});
const DRY = args["dry-run"]!;
const dataDir = args["data-dir"]!;
const TAG_MODEL = "google/gemini-3.5-flash-lite"; // analyzeClothingImage が使うモデル
const DETECT_MODELS = ["google/gemini-3.5-flash-lite", "google/gemini-3.8-flash"] as const;
const COMPARE_MODEL = "google/gemini-3.5-flash-lite";
const EMBED_MODEL = "google/gemini-embedding-2";
const GATEWAY_OPTS = { gateway: { disallowPromptTraining: true } };

// ---------------- 偽のモデル（--dry-run） ----------------
function hashBytes(s: string): number {
  return createHash("sha256").update(s).digest().readUInt32BE(0);
}
const usage = {
  inputTokens: { total: 1000, noCache: 1000, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 200, text: 200, reasoning: undefined },
};
function installMockProvider() {
  const lang = (modelId: string) =>
    new MockLanguageModelV4({
      modelId,
      doGenerate: async (opts) => {
        const sys = opts.prompt.find((m) => m.role === "system");
        const sysText = typeof sys?.content === "string" ? sys.content : "";
        const files = opts.prompt
          .flatMap((m) => (Array.isArray(m.content) ? m.content : []))
          .filter((p) => p.type === "file");
        const seed = hashBytes(JSON.stringify(files.map((f) => String((f as { data: unknown }).data).length)) + sysText.length);
        let out: unknown;
        if (sysText.includes("TRIAL_DETECT")) {
          out = {
            items: [
              { ...mockTags(seed), visibility: "full", box_2d: [100, 200, 600, 800] },
              { ...mockTags(seed + 1), category: "bottoms", visibility: "partial", box_2d: null },
            ],
          };
        } else if (sysText.includes("TRIAL_COMPARE")) {
          out = { ranking: seed % 3 === 0 ? [] : [2, 1] };
        } else {
          out = { ...mockAnalysis(seed) };
        }
        return {
          content: [{ type: "text" as const, text: JSON.stringify(out) }],
          finishReason: { unified: "stop" as const, raw: undefined },
          usage,
          warnings: [],
        };
      },
    });
  const emb = (modelId: string) =>
    new MockEmbeddingModelV4({
      modelId,
      doEmbed: async ({ values, providerOptions }) => {
        const content = (providerOptions as { google?: { content?: { inlineData?: { data: string } }[] } })?.google?.content;
        return {
          embeddings: values.map((_, i) => {
            const d = content?.[i]?.inlineData?.data ?? "";
            const h = createHash("sha256").update(d).digest();
            return Array.from(h.subarray(0, 8), (b) => b - 127);
          }),
          usage: { tokens: 1 },
          warnings: [],
        };
      },
    });
  (globalThis as { AI_SDK_DEFAULT_PROVIDER?: unknown }).AI_SDK_DEFAULT_PROVIDER = {
    specificationVersion: "v4",
    languageModel: lang,
    embeddingModel: emb,
    textEmbeddingModel: emb,
    imageModel: () => {
      throw new Error("mock: no image model");
    },
  };
}
const CATS = ["tops", "bottoms", "dress", "outer", "shoes", "bag"];
const COLORS = ["white", "black", "gray", "beige", "navy", "red"];
function mockTags(seed: number) {
  return {
    category: CATS[seed % CATS.length],
    subcategory: "other",
    main_color: COLORS[seed % COLORS.length],
    pattern: "solid",
    material_look: "other",
    sleeve_length: "not_applicable",
    layer_role: "base",
  };
}
function mockAnalysis(seed: number) {
  return {
    is_clothing: true,
    ...mockTags(seed),
    sub_colors: [],
    silhouette: "regular",
    thickness: "medium",
    warmth: 3,
    style_tags: [],
    suggested_seasons: [],
    suggested_title: "mock",
    confidence: Object.fromEntries(
      ["category", "subcategory", "color", "material", "thickness", "warmth", "layer_role", "seasons"].map((k) => [k, "medium"]),
    ),
    needs_user_check: [],
  };
}

// ---------------- 画像 ----------------
async function resizeJpeg(input: Uint8Array, longEdge: number): Promise<Buffer> {
  return sharp(input).rotate().resize(longEdge, longEdge, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
}

// ---------------- キャッシュ ----------------
const cacheDir = path.join(dataDir, DRY ? "cache-dryrun" : "cache"); // 偽の結果を本物のキャッシュに混ぜない
await mkdir(cacheDir, { recursive: true });
type Cached<T> = { value: T; costUsd: number; ms: number };
async function cached<T>(
  p: { stage: string; model: string; inputHash: string; config: string },
  fn: () => Promise<{ value: T; costUsd: number }>,
): Promise<Cached<T> & { fromCache: boolean }> {
  const file = path.join(cacheDir, `${cacheKey(p)}.json`);
  try {
    return { ...(JSON.parse(await readFile(file, "utf8")) as Cached<T>), fromCache: true };
  } catch {
    /* キャッシュなし */
  }
  const t0 = Date.now();
  const r = await fn();
  const out: Cached<T> = { value: r.value, costUsd: r.costUsd, ms: Date.now() - t0 };
  await writeFile(file, JSON.stringify(out));
  return { ...out, fromCache: false };
}

// ---------------- 入力の読み込み ----------------
type FlatItem = { id: string; ownerEmail: string; title: string; category: string; subcategory: string | null; main_color: string | null; file: string };
const flatsDir = path.join(dataDir, "flats");
const flatItems = JSON.parse(await readFile(path.join(flatsDir, "items.json"), "utf8")) as FlatItem[];
const truthRaw: unknown = JSON.parse(await readFile(path.join(dataDir, "truth.json"), "utf8"));
validateTruth(truthRaw, new Set(flatItems.map((f) => f.id)));
const truth = truthRaw;
const lookNames = Object.keys(truth.looks).sort();
const existingLooks = new Set(await readdir(path.join(dataDir, "looks")));
for (const n of lookNames) if (!existingLooks.has(n)) throw new Error(`looks/${n} がありません`);

// ---------------- 見込みの表示 ----------------
const avgItems = lookNames.reduce((s, n) => s + truth.looks[n].items.length, 0) / Math.max(1, lookNames.length);
const calls = {
  tag: flatItems.length,
  detect: lookNames.length * DETECT_MODELS.length,
  compare: Math.round(lookNames.length * (avgItems + 1) * 3),
  embed: args["skip-embedding"] ? 0 : Math.round(flatItems.length + lookNames.length * 2 * (avgItems + 1)),
};
// 目安：1回あたり入力 3000 / 出力 400 トークン（画像数枚）と仮定
const estimate =
  tokenCost(TAG_MODEL, calls.tag * 1500, calls.tag * 400) +
  tokenCost(DETECT_MODELS[0], lookNames.length * 3000, lookNames.length * 600) +
  tokenCost(DETECT_MODELS[1], lookNames.length * 3000, lookNames.length * 600) +
  tokenCost(COMPARE_MODEL, calls.compare * 3000, calls.compare * 50) +
  embeddingCost(calls.embed);
console.log(
  `呼び出し見込み：タグ付け ${calls.tag} / 着画の検出 ${calls.detect} / 見比べ ${calls.compare} / 埋め込み ${calls.embed} 回、費用の目安 約 $${estimate.toFixed(2)}（キャッシュ分は除かない上限寄りの目安）`,
);
if (!DRY && !args.yes) {
  console.log("--yes を付けて実行すると始めます。");
  process.exit(0);
}
if (DRY) installMockProvider();

// ---------------- 段階 1：平置きのタグ付け ----------------
const notes: string[] = [];
const flatTags = new Map<string, Tags>();
const flatBytes = new Map<string, Buffer>(); // 見比べ・埋め込み用の元画像（回転済みの JPEG）
for (const f of flatItems) {
  const raw = await readFile(path.join(flatsDir, f.file));
  const img = await resizeJpeg(raw, 1600);
  flatBytes.set(f.id, img);
  let analysis: z.infer<typeof ClothingImageAnalysisSchema> | null = null;
  try {
    const r = await cached({ stage: "tag", model: TAG_MODEL, inputHash: sha256(img), config: "v1" }, async () => ({
      value: await analyzeClothingImage(img),
      costUsd: 0, // analyzeClothingImage は usage を返さないため未計測
    }));
    analysis = r.value;
  } catch (e) {
    notes.push(`平置きのタグ付けに失敗 ${f.id}: ${errMsg(e)}（DB の値で代用）`);
  }
  flatTags.set(f.id, {
    category: analysis?.category ?? f.category ?? null,
    subcategory: analysis?.subcategory ?? f.subcategory ?? null,
    main_color: analysis?.main_color ?? f.main_color ?? null,
    pattern: analysis?.pattern ?? null,
    material_look: analysis?.material_look ?? null,
    sleeve_length: analysis?.sleeve_length ?? null,
    layer_role: analysis?.layer_role ?? null,
  });
}
console.log(`段階1：平置き ${flatItems.length} 件のタグ付け完了`);
const flatList = flatItems.map((f) => ({ id: f.id, tags: flatTags.get(f.id)! }));
// 検出の割合の正解は、人が登録した DB の category を優先する（AI のタグの誤りを混ぜない）
// 「写真だけで登録」のままの服は category が仮の other なので、AI のタグで代用する
const dbCategory = new Map(
  flatItems.map((f) => [f.id, f.category && f.category !== "other" ? f.category : null]),
);
const categoryOf = (id: string) => dbCategory.get(id) ?? flatTags.get(id)?.category ?? null;

// ---------------- 段階 2：着画の検出 ----------------
const Cat = ClothingImageAnalysisSchema.shape.category.unwrap();
const Sub = ClothingImageAnalysisSchema.shape.subcategory.unwrap();
const Col = ClothingImageAnalysisSchema.shape.main_color.unwrap();
const Pat = ClothingImageAnalysisSchema.shape.pattern.unwrap();
const Mat = ClothingImageAnalysisSchema.shape.material_look.unwrap();
const Sle = ClothingImageAnalysisSchema.shape.sleeve_length.unwrap();
const Lay = ClothingImageAnalysisSchema.shape.layer_role.unwrap();
const DetectionSchema = z.object({
  items: z.array(
    z.object({
      category: Cat,
      subcategory: Sub,
      main_color: Col,
      pattern: Pat,
      material_look: Mat,
      sleeve_length: Sle,
      layer_role: Lay,
      visibility: z.enum(["full", "partial"]),
      box_2d: z.array(z.number()).nullable(),
    }),
  ),
});
type Detection = z.infer<typeof DetectionSchema>["items"][number];

const DETECT_SYSTEM = [
  "TRIAL_DETECT",
  "あなたはクローゼットアプリの画像解析アシスタントです。",
  "着画（人が服を着ている写真）に写っている服を、1着ずつ全部見つけて、指定のJSONスキーマどおりに返してください。",
  "- 靴とバッグも1着として数える。",
  "- 一部しか見えない服は visibility = partial、全体が見える服は full。",
  "- box_2d は [ymin, xmin, ymax, xmax]（画像全体を 0〜1000 とした位置）。分からなければ null。",
  "- 分からない項目は、もっともらしい値で埋めずに other にする。",
  "- 人物の顔・体型・年齢・性別、背景は一切記述しない。服以外のことは書かない。",
].join("\n");

const COMPARE_SYSTEM = [
  "TRIAL_COMPARE",
  "あなたはクローゼットアプリの画像比較アシスタントです。",
  "最初の画像は、着画から切り抜いた1着の服（または着画全体と探す服の説明）です。続く画像は、持ち服の候補（候補1, 候補2, …）です。",
  "最初の画像と同じ服だと思う順に、候補の番号を並べて ranking に返してください。どの候補も同じ服でなければ空の配列にする。",
  "人物の顔・体型・背景は見ないこと。服の色・形・柄・素材感だけで判断する。",
].join("\n");

function errMsg(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).slice(0, 200);
}

async function detect(model: string, look: Buffer): Promise<Cached<Detection[]>> {
  return cached({ stage: "detect", model, inputHash: sha256(look), config: sha256(DETECT_SYSTEM) }, async () => {
    const res = await generateText({
      model,
      system: DETECT_SYSTEM,
      messages: [{ role: "user", content: [{ type: "text", text: "この着画の服を全部返してください。" }, { type: "file", mediaType: "image/jpeg", data: look }] }],
      output: Output.object({ schema: DetectionSchema }),
      abortSignal: AbortSignal.timeout(60_000),
      maxRetries: 1,
      providerOptions: GATEWAY_OPTS,
    });
    return {
      value: res.output.items,
      costUsd: tokenCost(model, res.usage.inputTokens ?? 0, res.usage.outputTokens ?? 0),
    };
  });
}

const CompareSchema = z.object({ ranking: z.array(z.number()) });
async function compare(
  cropJpeg: Buffer,
  describe: string | null,
  candidates: string[],
  size: number,
): Promise<Cached<number[]>> {
  const small = await resizeJpeg(cropJpeg, size);
  const candImgs = await Promise.all(candidates.map((id) => resizeJpeg(flatBytes.get(id)!, size)));
  const inputHash = sha256(Buffer.concat([small, ...candImgs]).toString("base64") + (describe ?? ""));
  return cached({ stage: `compare${size}`, model: COMPARE_MODEL, inputHash, config: sha256(COMPARE_SYSTEM) }, async () => {
    const content: ({ type: "text"; text: string } | { type: "file"; mediaType: "image/jpeg"; data: Uint8Array })[] = [
      { type: "text", text: describe ? `着画全体です。探す服：${describe}` : "着画の切り抜きです。" },
      { type: "file", mediaType: "image/jpeg", data: small },
    ];
    candImgs.forEach((img, i) => {
      content.push({ type: "text", text: `候補${i + 1}` }, { type: "file", mediaType: "image/jpeg", data: img });
    });
    const res = await generateText({
      model: COMPARE_MODEL,
      system: COMPARE_SYSTEM,
      messages: [{ role: "user", content }],
      output: Output.object({ schema: CompareSchema }),
      abortSignal: AbortSignal.timeout(60_000),
      maxRetries: 1,
      providerOptions: GATEWAY_OPTS,
    });
    return {
      value: res.output.ranking,
      costUsd: tokenCost(COMPARE_MODEL, res.usage.inputTokens ?? 0, res.usage.outputTokens ?? 0),
    };
  });
}

let embeddingDisabled = args["skip-embedding"]!;
async function embedImage(img: Buffer): Promise<Cached<number[]> | null> {
  if (embeddingDisabled) return null;
  const small = await resizeJpeg(img, 768);
  try {
    return await cached({ stage: "embed", model: EMBED_MODEL, inputHash: sha256(small), config: "v1" }, async () => {
      const r = await embed({
        model: EMBED_MODEL,
        value: "image", // 実際の内容は providerOptions.google.content で渡す
        providerOptions: {
          ...GATEWAY_OPTS,
          google: { content: [{ inlineData: { mimeType: "image/jpeg", data: small.toString("base64") } }] },
        },
        maxRetries: 0,
      });
      return { value: r.embedding, costUsd: embeddingCost(1) };
    });
  } catch (e) {
    embeddingDisabled = true;
    notes.push(`埋め込みを飛ばしました（最初の失敗）：${errMsg(e)}`);
    return null;
  }
}

// ---------------- 段階 3：順位付け ----------------
type VariantOut = { rankings: string[][]; costUsd: number; ms: number; error?: string };
type LookOut = { detections: Detection[]; detectCostUsd: number; detectMs: number; detectError?: string; variants: Record<string, VariantOut> };
const outcomes: Record<string, Record<string, LookOut>> = {}; // look -> detModel -> LookOut

const flatEmbeddings = new Map<string, number[]>();
let flatEmbedCost = 0;
if (!embeddingDisabled) {
  for (const f of flatItems) {
    const r = await embedImage(flatBytes.get(f.id)!);
    if (!r) break;
    flatEmbeddings.set(f.id, r.value);
    flatEmbedCost += r.costUsd;
  }
  // 画像の内容が無視されていないか確認（別の服の埋め込みがほぼ同じなら、内容が渡っていない）
  const vs = [...flatEmbeddings.values()];
  if (vs.length >= 2 && vs.every((v) => cosineSimilarity(v, vs[0]) > 0.9999)) {
    embeddingDisabled = true;
    flatEmbeddings.clear();
    notes.push("埋め込みを飛ばしました：どの平置きもほぼ同じベクトル（Gateway 経由で画像の内容が渡っていない可能性）");
  }
}

for (const name of lookNames) {
  const lookBuf = await sharp(await readFile(path.join(dataDir, "looks", name))).rotate().jpeg({ quality: 90 }).toBuffer();
  const { width = 0, height = 0 } = await sharp(lookBuf).metadata();
  outcomes[name] = {};
  for (const model of DETECT_MODELS) {
    const lo: LookOut = { detections: [], detectCostUsd: 0, detectMs: 0, variants: {} };
    outcomes[name][model] = lo;
    try {
      const d = await detect(model, lookBuf);
      lo.detections = d.value;
      lo.detectCostUsd = d.costUsd;
      lo.detectMs = d.ms;
    } catch (e) {
      lo.detectError = errMsg(e);
      notes.push(`検出に失敗 ${name} / ${model}: ${lo.detectError}`);
      continue;
    }
    const dets = lo.detections;
    const tagOrders = dets.map((d) => rankByTags(d, flatList));
    const crops = await Promise.all(
      dets.map(async (d) => {
        const region = cropRegion(d.box_2d, width, height);
        return region
          ? { jpeg: await sharp(lookBuf).extract(region).jpeg({ quality: 90 }).toBuffer(), describe: null as string | null }
          : { jpeg: lookBuf, describe: `${d.main_color ?? ""}の${d.subcategory ?? d.category}` };
      }),
    );

    lo.variants["tags|-"] = { rankings: tagOrders, costUsd: 0, ms: 0 };

    const sizes = model === DETECT_MODELS[0] ? [384, 1024] : [384];
    for (const size of sizes) {
      const v: VariantOut = { rankings: [], costUsd: 0, ms: 0 };
      lo.variants[`compare|${size}`] = v;
      for (let i = 0; i < dets.length; i++) {
        const cand = tagOrders[i].slice(0, 5);
        try {
          const r = await compare(crops[i].jpeg, crops[i].describe, cand, size);
          v.rankings.push(mergeRanking(r.value, cand, tagOrders[i]));
          v.costUsd += r.costUsd;
          v.ms += r.ms;
        } catch (e) {
          v.rankings.push(tagOrders[i]);
          v.error = errMsg(e);
          notes.push(`見比べに失敗 ${name} / ${model} / ${size}px：${v.error}（タグの順で代用）`);
        }
      }
    }

    if (!embeddingDisabled) {
      const v: VariantOut = { rankings: [], costUsd: 0, ms: 0 };
      for (let i = 0; i < dets.length && !embeddingDisabled; i++) {
        const e = await embedImage(crops[i].jpeg);
        if (!e) break;
        const ranked = flatItems
          .map((f) => ({ id: f.id, s: cosineSimilarity(e.value, flatEmbeddings.get(f.id)!) }))
          .sort((a, b) => b.s - a.s || (a.id < b.id ? -1 : 1))
          .map((x) => x.id);
        v.rankings.push(ranked);
        v.costUsd += e.costUsd;
        v.ms += e.ms;
      }
      if (v.rankings.length === dets.length) lo.variants["embedding|-"] = v;
    }
  }
  console.log(`段階2〜3：${name} 完了`);
}

// ---------------- 段階 4〜5：採点と集計 ----------------
const variantKeys = new Set<string>();
for (const l of Object.values(outcomes)) for (const m of Object.values(l)) for (const k of Object.keys(m.variants)) variantKeys.add(k);
const methodName = (k: string) => (k.startsWith("tags") ? "タグだけ" : k.startsWith("compare") ? "タグ+AI見比べ" : "埋め込み");
const rows: VariantRow[] = [];
for (const model of DETECT_MODELS) {
  for (const key of [...variantKeys].sort()) {
    const items: ItemScore[] = [];
    let cost = key.startsWith("embedding") ? flatEmbedCost : 0;
    let ms = 0;
    let n = 0;
    for (const name of lookNames) {
      const lo = outcomes[name][model];
      const v = lo?.variants[key];
      if (!v) {
        // 検出に失敗した着画も分母に入れる（未検出・順位なし）
        if (lo?.detectError) items.push(...scoreLook(truth.looks[name], categoryOf, [], []));
        continue;
      }
      n++;
      items.push(...scoreLook(truth.looks[name], categoryOf, lo.detections, v.rankings));
      cost += lo.detectCostUsd + v.costUsd;
      ms += lo.detectMs + v.ms;
    }
    if (n === 0) continue;
    rows.push({
      method: methodName(key),
      detectModel: model,
      size: key.endsWith("-") ? "-" : `${key.split("|")[1]}px`,
      agg: aggregateScores(items),
      looks: n,
      costUsd: cost,
      ms,
    });
  }
}
notes.push(`着画 ${lookNames.length} 枚、平置き ${flatItems.length} 件${DRY ? "（--dry-run：偽のモデルの結果。数字に意味はありません）" : ""}`);
notes.push("費用にはキャッシュ済みの呼び出しの元の費用を含む。平置きのタグ付けの費用は未計測。埋め込みは平置き分の費用を全着画に足している。");
if (embeddingDisabled && !args["skip-embedding"]) notes.push("埋め込みの行はありません（上のメモを参照）");

const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 13).replace("T", "-");
const outDir = path.join(dataDir, "results", stamp);
await mkdir(outDir, { recursive: true });
await writeFile(path.join(outDir, "results.json"), JSON.stringify({ rows, outcomes, notes }, null, 2));
await writeFile(path.join(outDir, "summary.md"), renderSummary(rows, notes));
console.log(`完了：${path.join(outDir, "summary.md")}`);
