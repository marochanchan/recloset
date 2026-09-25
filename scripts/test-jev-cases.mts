// Jev (typesafe-ai/jev) の判断傾向を比較確認するためのテストスクリプト。
// 同一のFACT（着用履歴）をベースに、FEELING（気持ち・理由）だけを変えた
// 3ケースを用意し、KEEP / RETRY / REBYE の判定がどう変化するかを比較する。
//
// Supabase・実際のRe:closetユーザーデータには接続せず、固定の架空データのみ使用する。
// 初回疎通確認用の scripts/test-jev.mts とは別ファイルとして作成。
//
// 実行方法（AI_GATEWAY_API_KEYは.env.localから読み込む）:
//   node --env-file=.env.local scripts/test-jev-cases.mts
//
// AI_GATEWAY_API_KEYの値は一切ログ出力しない。

import { experimental_evaluate as evaluate } from "ai";

// 3ケース共通のFACT（客観的な着用データ）
const commonFact = {
  wear_count: 2,
  days_since_last_worn: 90,
  days_since_purchase: 365,
  favorite: true,
  status: "closet",
  category: "tops",
  season: "all_season",
  current_season: "autumn",
};

type CaseInput = {
  name: string;
  description: string;
  state: Record<string, string | number | boolean | string[]>;
};

const cases: CaseInput[] = [
  {
    name: "CASE A",
    description: "着ていないけど、今も好き（RETRYが高くなることを期待）",
    state: {
      ...commonFact,
      current_feeling: "like",
      want_to_wear_again: "yes",
      not_worn_reasons: ["hard_to_style"],
    },
  },
  {
    name: "CASE B",
    description:
      "着ていないし、今は気持ちも離れている（REBYEが高くなることを期待。ただし断定はしない）",
    state: {
      ...commonFact,
      current_feeling: "dislike",
      want_to_wear_again: "no",
      not_worn_reasons: ["somehow_not_reaching_for_it"],
    },
  },
  {
    name: "CASE C",
    description:
      "着ていない理由が季節（90日未着用という事実だけでREBYEに強く寄らないことを期待）",
    state: {
      ...commonFact,
      season: "winter",
      current_feeling: "like",
      want_to_wear_again: "yes",
      not_worn_reasons: ["out_of_season"],
    },
  },
  {
    name: "CASE D",
    description:
      "本人もどうしたいか分からない服（KEEP/RETRY/REBYEのprobabilitiesが極端にならないかを確認。CASE D専用のFACT）",
    state: {
      wear_count: 3,
      days_since_last_worn: 180,
      days_since_purchase: 730,
      favorite: true,
      status: "closet",
      category: "tops",
      season: "all_season",
      current_season: "autumn",
      current_feeling: "neutral",
      want_to_wear_again: "unsure",
      not_worn_reasons: ["do_not_remember"],
    },
  },
];

// KEEP / RETRY / REBYE の定義。
// 「着ていない = REBYE」と短絡させず、あくまで次の行動候補の提示であって
// 最終決定ではないことをJevへの指示にも明記する。
const decisionInstructions =
  "ユーザーの服1着について、FACT（客観的な着用データ）とFEELING（本人の気持ち）を踏まえて、" +
  "次にとるべき行動の候補を1つ選んでください。これは最終決定ではなく、ユーザー自身が" +
  "着る・残す・手放すを考えるための判断材料です。着用回数が少ない、または長期間着ていない" +
  "という事実だけでREBYEを選ばないでください。ユーザーの気持ち（current_feeling, " +
  "want_to_wear_again）や、着ていない理由（not_worn_reasons）を重視してください。";

const decisionCriteria = {
  KEEP: "現在も活用している、または明確に残しておきたい理由がある",
  RETRY:
    "最近着ていなくても、愛着や再着用意欲があり、手放す前にもう一度着たり活用方法を試す価値がある",
  REBYE:
    "長期間活用されておらず、再着用意欲も低いなど、手放すことを検討する材料が揃っている（最終判断ではなく候補として）",
};

async function runCase(testCase: CaseInput) {
  const result = await evaluate({
    model: "typesafe-ai/jev",
    state: testCase.state,
    questions: {
      decision: {
        type: "choice",
        instructions: decisionInstructions,
        criteria: decisionCriteria,
      },
    },
  });

  return result.answers.decision;
}

async function main() {
  for (const testCase of cases) {
    console.log(`\n=== ${testCase.name}: ${testCase.description} ===`);
    const decision = await runCase(testCase);
    console.log(JSON.stringify(decision, null, 2));
  }
}

main().catch((error) => {
  console.error("Jev evaluate call failed:", error);
  process.exitCode = 1;
});
