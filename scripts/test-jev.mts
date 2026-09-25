// Jev (typesafe-ai/jev) 経由のAI Gateway疎通テスト用スクリプト。
// Supabase/Re:closetの実データには接続せず、固定の架空データのみを使用する。
//
// 実行方法（AI_GATEWAY_API_KEYは.env.localから読み込む）:
//   node --env-file=.env.local scripts/test-jev.mts
//
// AI_GATEWAY_API_KEYの値は一切ログ出力しない。

import { experimental_evaluate as evaluate } from "ai";

const fakeClothingState = {
  wear_count: 2,
  days_since_last_worn: 90,
  favorite: true,
  status: "closet",
};

async function main() {
  const result = await evaluate({
    model: "typesafe-ai/jev",
    state: fakeClothingState,
    questions: {
      decision: {
        type: "choice",
        instructions: "この服について次にとるべき行動を選んでください。",
        criteria: {
          keep: "特に理由がなくても着用を継続する価値がある",
          retry: "しばらく着ていないが、もう一度着る価値がありそうだ",
          let_go: "着用頻度が低く、手放すことを検討すべきだ",
        },
      },
    },
  });

  console.log(JSON.stringify(result.answers, null, 2));
}

main().catch((error) => {
  console.error("Jev evaluate call failed:", error);
  process.exitCode = 1;
});
