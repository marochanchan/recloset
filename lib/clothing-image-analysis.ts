import { generateText, Output } from "ai";
import { z } from "zod";

// ============================================================
// 服画像のAI解析（Vercel AI Gateway経由, Gemini 3.5 Flash-Lite）
//
// - サーバー側（Server Action）からだけ呼ぶ。APIキーはGateway側の環境変数で、
//   クライアントには渡らない。
// - スキーマ・指示文は画像AI PoC（scripts/test-image-analysis.mts）で
//   4着の実画像により検証した内容をそのまま使う。変更する場合は、PoCで
//   再検証してから両方を更新すること。
// - 解析結果はDBに保存しない。登録フォームでは現在 title / category だけを使い、
//   他の項目は将来（季節・種類・色など）のために型として保持している。
// ============================================================

export const CLOTHING_IMAGE_ANALYSIS_MODEL = "google/gemini-3.5-flash-lite";

const TIMEOUT_MS = 20_000;
const MAX_RETRIES = 1;

const Category = z.enum([
  "tops",
  "bottoms",
  "dress",
  "outer",
  "shoes",
  "bag",
  "other",
]);

const Subcategory = z.enum([
  "tshirt",
  "shirt_blouse",
  "knit",
  "cardigan",
  "vest",
  "bustier",
  "sweatshirt_hoodie",
  "jacket",
  "coat",
  "pants",
  "skirt",
  "shorts",
  "dress",
  "jumpsuit",
  "other",
]);

const Color = z.enum([
  "white",
  "black",
  "gray",
  "beige",
  "brown",
  "navy",
  "blue",
  "green",
  "yellow",
  "orange",
  "red",
  "pink",
  "purple",
  "multi",
  "other",
]);

const Pattern = z.enum([
  "solid",
  "stripe",
  "check",
  "dot",
  "floral",
  "print",
  "animal",
  "other",
]);

const SleeveLength = z.enum([
  "sleeveless",
  "short",
  "three_quarter",
  "long",
  "not_applicable",
]);

const Silhouette = z.enum(["fitted", "regular", "relaxed", "oversized"]);

// 「〜に見える」素材感。素材そのもの（本革/合皮など）を確定するものではない
const MaterialLook = z.enum([
  "cotton_like",
  "linen_like",
  "knit",
  "denim",
  "leather_like",
  "wool_like",
  "fleece_like",
  "padded",
  "sheer",
  "satin_like",
  "sporty",
  "other",
]);

const Thickness = z.enum(["thin", "medium", "thick"]);

// 重ね着での役割。ベスト・ビスチェは「上に重ねる服」として普通のトップスと区別する
//   base: 単体で着るトップス・インナー / mid: カーディガン・ニット等の中間着
//   over_layer: ベスト・ビスチェ等、他の服の上に重ねる服 / outer: ジャケット・コート
//   one_piece: ワンピース・オールインワン / bottom: ボトムス / accessory: 靴・バッグ等
const LayerRole = z.enum([
  "base",
  "mid",
  "over_layer",
  "outer",
  "one_piece",
  "bottom",
  "accessory",
]);

const StyleTag = z.enum([
  "casual",
  "feminine",
  "formal",
  "street",
  "sporty",
  "minimal",
  "vintage",
]);

// 季節は複数選択（「オールシーズン」は4つ全部で表す）
const Season = z.enum(["spring", "summer", "autumn", "winter"]);

const Confidence = z.enum(["high", "medium", "low"]);

const UserCheckField = z.enum([
  "category",
  "subcategory",
  "color",
  "pattern",
  "material_look",
  "thickness",
  "warmth",
  "layer_role",
  "seasons",
]);

export const ClothingImageAnalysisSchema = z.object({
  is_clothing: z.boolean(),
  category: Category.nullable(),
  subcategory: Subcategory.nullable(),
  main_color: Color.nullable(),
  sub_colors: z.array(Color).max(2),
  pattern: Pattern.nullable(),
  sleeve_length: SleeveLength.nullable(),
  silhouette: Silhouette.nullable(),
  material_look: MaterialLook.nullable(),
  thickness: Thickness.nullable(),
  // 1=真夏向け（とても涼しい）… 5=真冬向け（とても暖かい）
  warmth: z.number().int().min(1).max(5).nullable(),
  layer_role: LayerRole.nullable(),
  style_tags: z.array(StyleTag).max(3),
  suggested_seasons: z.array(Season).max(4),
  suggested_title: z.string().max(30).nullable(),
  confidence: z.object({
    category: Confidence,
    subcategory: Confidence,
    color: Confidence,
    material: Confidence,
    thickness: Confidence,
    warmth: Confidence,
    layer_role: Confidence,
    seasons: Confidence,
  }),
  needs_user_check: z.array(UserCheckField),
});

export type ClothingImageAnalysis = z.infer<typeof ClothingImageAnalysisSchema>;

const SYSTEM_PROMPT = [
  "あなたはクローゼットアプリの服登録を手伝う画像解析アシスタントです。",
  "画像に写っている服1着の特徴を、指定のJSONスキーマどおりに返してください。",
  "",
  "【最重要: 分からないことを断定しない】",
  "- 画像から判断できない項目は null にする。もっともらしい値で埋めない。",
  "- 推定はできるが自信がない項目は、confidence を low（または medium）にし、needs_user_check に入れる。",
  "- 素材の種類（本革か合皮か、ウールの混率など）、裏地の有無、実際の生地の厚さ、暖かさ、着られる季節は、写真だけでは確定できない。これらは見た目からの推定に留め、confidence.material / thickness / warmth / seasons を high にしない。",
  "- material_look は「〜のように見える」素材感であり、素材の断定ではない。",
  "",
  "【分類のルール】",
  "- category は既存アプリの値（tops / bottoms / dress / outer / shoes / bag / other）。",
  "- ジャケット・コートは category = outer、layer_role = outer。",
  "- ベストは subcategory = vest、ビスチェは subcategory = bustier。どちらも category = tops、layer_role = over_layer（他の服の上に重ねる服）。普通のトップスと区別する。",
  "- カーディガンは subcategory = cardigan、layer_role = mid（前を開けて羽織る中間着）。",
  "- シャツ・ブラウス・Tシャツなど単体で着るトップスは layer_role = base。",
  "- ワンピース・オールインワンは category = dress、layer_role = one_piece。",
  "- ボトムスは layer_role = bottom。靴・バッグは layer_role = accessory。",
  "- 写真に複数の服が写っている場合は、最も大きく中心に写っている1着だけを解析し、category を needs_user_check に入れる。",
  "- 服が写っていない場合は is_clothing = false とし、他の項目は null または空配列にする。",
  "",
  "【季節（suggested_seasons）】",
  "- spring / summer / autumn / winter から、その服を着やすい季節を複数選ぶ（例: 薄手のブラウスなら春・夏・秋）。",
  "- 判断できなければ空配列にし、seasons を needs_user_check に入れる。",
  "",
  "【warmth（暖かさ）】",
  "- 1=真夏向け（とても涼しい）、2=涼しい、3=中間、4=暖かい、5=真冬向け（とても暖かい）。",
  "- 見た目の厚み・素材感・形からの推定に留める。判断できなければ null。",
  "",
  "【書かないこと】",
  "- 人物の顔・体型・年齢・性別、背景・部屋・場所など、服以外のことは一切記述しない。",
  "- 自由記述は suggested_title だけ。日本語で30文字以内の、服を見分けるための短い名前にする（例: 「白の長袖ブラウス」）。ブランド名は画像に明確に読めない限り書かない。",
].join("\n");

const USER_PROMPT = "この服の特徴をスキーマどおりに返してください。";


/**
 * 画像1枚（JPEG）を解析する。失敗時は例外を投げる（呼び出し側で手入力へ戻す）。
 * disallowPromptTraining: true で、プロンプトを学習に使わないプロバイダへの
 * ルーティングを要求する（lib/ai-elaboration.ts と同じ方針）。
 */
export async function analyzeClothingImage(
  image: Uint8Array,
): Promise<ClothingImageAnalysis> {
  const { output } = await generateText({
    model: CLOTHING_IMAGE_ANALYSIS_MODEL,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: USER_PROMPT },
          { type: "file", mediaType: "image/jpeg", data: image },
        ],
      },
    ],
    output: Output.object({ schema: ClothingImageAnalysisSchema }),
    abortSignal: AbortSignal.timeout(TIMEOUT_MS),
    maxRetries: MAX_RETRIES,
    providerOptions: {
      gateway: {
        disallowPromptTraining: true,
      },
    },
  });
  return output;
}
