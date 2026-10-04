// Gemini (Vercel AI Gateway経由, google/gemini-2.5-flash-lite) の
// 疎通テスト用スクリプト。Supabase/Re:closetの実データには接続せず、
// 固定の架空データのみを使用する。
//
// 注意: 実行するとGemini呼び出しが1回発生し、Vercel AI Gatewayの
// Budgetを消費します。実行するかどうかは人間側の判断で行ってください。
//
// 実行方法（AI_GATEWAY_API_KEYは.env.localから読み込む）:
//   node --env-file=.env.local scripts/test-gemini.mts
//
// AI_GATEWAY_API_KEYの値は一切ログ出力しない。

import { generateText } from "ai";

const GEMINI_ELABORATION_MODEL = "google/gemini-2.5-flash-lite";

const fakeSystemPrompt =
  "あなたはRe:closetというアプリの一部で、ユーザーが手持ちの服について" +
  "「残す・もう一度試す・手放す」を考えるための短い補足コメントを書きます。" +
  "「手放すべき」「残すべき」のような最終判断や命令は書かないこと。" +
  "断定を避け、本人が考えるための視点を提示する文体にすること。" +
  "日本語で1〜3文、短く丁寧に書くこと。";

const fakePrompt = [
  "以下はある服のAI診断結果です。本人がもう少し考えるための短い補足コメントを書いてください。",
  "",
  "診断タイプ: REBYE",
  "カテゴリー: トップス",
  "シーズン: 冬",
  "現在の季節: 秋",
  "お気に入り: いいえ",
  "最後に着てからの日数: 着用記録なし",
  "購入してからの日数: 不明",
  "今の気持ち: 今は好きではない",
  "もう一度着たいか: わからない",
  "着ていない理由: コーディネートが難しい、着る機会がない",
  "提示されたNext Action:",
  "  タイトル: 手放し候補として整理してみよう",
  "  本文: まだ迷いがあるようなので、今すぐ手放す必要はありません。",
].join("\n");

async function main() {
  const { text } = await generateText({
    model: GEMINI_ELABORATION_MODEL,
    system: fakeSystemPrompt,
    prompt: fakePrompt,
    maxOutputTokens: 200,
    providerOptions: {
      gateway: {
        disallowPromptTraining: true,
      },
    },
  });

  console.log(text);
}

main().catch((error) => {
  console.error("Gemini generateText call failed:", error);
  process.exitCode = 1;
});
