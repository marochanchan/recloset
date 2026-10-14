// Re:Garden（lib/garden.ts・lib/garden-copy.ts・lib/garden-characters.ts・
// lib/garden-query.ts）の自動テスト。DB・ネットワーク・ブラウザには接続しない
// （Supabaseクライアントはモックを使う）。
//
// 実行方法:
//   node --test scripts/test-garden.mts

import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { describe, test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      return nextResolve(pathToFileURL(`${repoRoot}${specifier.slice(2)}.ts`).href, context);
    }
    return nextResolve(specifier, context);
  },
});

const {
  buildGardenGrowth,
  claimGardenStageCelebration,
  GARDEN_STAGES,
  getGardenStageStorageKey,
  getGardenStageIndex,
} = await import("../lib/garden.ts");
const { getGardenCelebrationMessage, getGardenNextStageMessage } = await import(
  "../lib/garden-copy.ts"
);
const { getGardenCharacterImagePath, getGardenCharacterImageSrc } = await import(
  "../lib/garden-characters.ts"
);
const { fetchGardenGrowth } = await import("../lib/garden-query.ts");

describe("getGardenStageIndex（6段階のしきい値）", () => {
  test("種0・芽3・若葉10・つぼみ25・花50・実100", () => {
    const cases: [number, number][] = [
      [0, 0],
      [2, 0],
      [3, 1],
      [9, 1],
      [10, 2],
      [24, 2],
      [25, 3],
      [49, 3],
      [50, 4],
      [99, 4],
      [100, 5],
      [250, 5],
    ];
    for (const [points, index] of cases) {
      assert.equal(getGardenStageIndex(points), index, `${points}pt`);
    }
    assert.deepEqual(
      GARDEN_STAGES.map((stage) => stage.key),
      ["seed", "sprout", "young_leaf", "bud", "flower", "fruit"],
    );
  });
});

describe("buildGardenGrowth", () => {
  test("5種類の日数を同じ重みで合計する", () => {
    const growth = buildGardenGrowth([
      { kind: "register", day_count: 2 },
      { kind: "wear", day_count: 4 },
      { kind: "review", day_count: 3 },
      { kind: "organize", day_count: 1 },
      { kind: "circulate", day_count: 1 },
    ]);
    assert.equal(growth.totalPoints, 11);
    assert.deepEqual(growth.pointsByKind, {
      register: 2,
      wear: 4,
      review: 3,
      organize: 1,
      circulate: 1,
    });
    assert.equal(growth.stage.key, "young_leaf");
    assert.equal(growth.nextStage?.key, "bud");
    assert.equal(growth.pointsToNextStage, 14);
    assert.equal(growth.progressToNextStage, 1 / 15);
  });

  test("行動がなければ種・0pt", () => {
    const growth = buildGardenGrowth([]);
    assert.equal(growth.totalPoints, 0);
    assert.equal(growth.stage.key, "seed");
    assert.equal(growth.pointsToNextStage, 3);
    assert.equal(growth.progressToNextStage, 0);
  });

  test("知らない種類・不正な日数は数えず、同じ種類の重複は二重に数えない", () => {
    const growth = buildGardenGrowth([
      { kind: "unknown", day_count: 50 },
      { kind: "wear", day_count: -1 },
      { kind: "review", day_count: 1.5 },
      { kind: "register", day_count: "3" },
      { kind: "register", day_count: 2 },
    ]);
    assert.equal(growth.totalPoints, 3);
    assert.equal(growth.pointsByKind.register, 3);
  });

  test("100pt以降も累計は増え、次の段階はない", () => {
    const growth = buildGardenGrowth([
      { kind: "wear", day_count: 90 },
      { kind: "review", day_count: 40 },
    ]);
    assert.equal(growth.totalPoints, 130);
    assert.equal(growth.stage.key, "fruit");
    assert.equal(growth.nextStage, null);
    assert.equal(growth.pointsToNextStage, null);
    assert.equal(growth.progressToNextStage, 1);
    assert.match(getGardenNextStageMessage(growth), /実りました/);
  });
});

describe("claimGardenStageCelebration（段階が上がったときに一度だけ・ユーザーごと）", () => {
  const USER_A = "aaaaaaaa-0000-4000-8000-00000000000a";
  const USER_B = "bbbbbbbb-0000-4000-8000-00000000000b";
  const createStorage = (initial: Record<string, string> = {}) => {
    const data = new Map<string, string>(Object.entries(initial));
    return {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value),
      data,
    };
  };

  test("キーはユーザーごと", () => {
    assert.equal(
      getGardenStageStorageKey(USER_A),
      `recloset:garden-seen-stage:${USER_A}`,
    );
    assert.notEqual(getGardenStageStorageKey(USER_A), getGardenStageStorageKey(USER_B));
  });

  test("初めて見たときは記録だけして、お祝いは出さない", () => {
    const storage = createStorage();
    assert.equal(claimGardenStageCelebration({ userId: USER_A, stageIndex: 3, storage }), false);
    assert.equal(storage.data.get(getGardenStageStorageKey(USER_A)), "3");
  });

  test("上がったときだけ一度出す", () => {
    const storage = createStorage({ [getGardenStageStorageKey(USER_A)]: "1" });
    assert.equal(claimGardenStageCelebration({ userId: USER_A, stageIndex: 2, storage }), true);
    assert.equal(claimGardenStageCelebration({ userId: USER_A, stageIndex: 2, storage }), false);
  });

  test("同じブラウザの別のアカウントの記録とは混ざらない", () => {
    const storage = createStorage({ [getGardenStageStorageKey(USER_A)]: "4" });
    // B は初めて見るので出さない（A の段階4と比べない）
    assert.equal(claimGardenStageCelebration({ userId: USER_B, stageIndex: 1, storage }), false);
    // B が上がったら B だけ出す。A の記録は変わらない
    assert.equal(claimGardenStageCelebration({ userId: USER_B, stageIndex: 2, storage }), true);
    assert.equal(storage.data.get(getGardenStageStorageKey(USER_A)), "4");
    assert.equal(claimGardenStageCelebration({ userId: USER_A, stageIndex: 4, storage }), false);
  });

  test("下がったとき（取り消しなど）は出さず、記録を合わせる", () => {
    const storage = createStorage({ [getGardenStageStorageKey(USER_A)]: "3" });
    assert.equal(claimGardenStageCelebration({ userId: USER_A, stageIndex: 2, storage }), false);
    assert.equal(storage.data.get(getGardenStageStorageKey(USER_A)), "2");
  });

  test("ユーザー不明・storageなし・不正な記録・読み書きの失敗では出さない", () => {
    const storage = createStorage();
    assert.equal(claimGardenStageCelebration({ userId: null, stageIndex: 2, storage }), false);
    assert.equal(storage.data.size, 0);
    assert.equal(
      claimGardenStageCelebration({ userId: USER_A, stageIndex: 2, storage: null }),
      false,
    );
    assert.equal(
      claimGardenStageCelebration({
        userId: USER_A,
        stageIndex: 2,
        storage: createStorage({ [getGardenStageStorageKey(USER_A)]: "abc" }),
      }),
      false,
    );
    assert.equal(
      claimGardenStageCelebration({
        userId: USER_A,
        stageIndex: 2,
        storage: {
          getItem: () => {
            throw new Error("blocked");
          },
          setItem: () => {},
        },
      }),
      false,
    );
  });
});

describe("キャラクター画像", () => {
  test("ファイル名の規則", () => {
    assert.equal(
      getGardenCharacterImagePath("default", 2, "young_leaf"),
      "/garden/characters/default/stage-2-young_leaf.webp",
    );
  });

  test("未配置（hasImages: false）ならnull、配置済みなら規則どおりのパス", () => {
    assert.equal(getGardenCharacterImageSrc({ id: "default", hasImages: false }, 0), null);
    assert.equal(
      getGardenCharacterImageSrc({ id: "mint", hasImages: true }, 5),
      "/garden/characters/mint/stage-5-fruit.webp",
    );
    assert.equal(getGardenCharacterImageSrc({ id: "mint", hasImages: true }, 9), null);
  });
});

test("お祝いの言葉", () => {
  assert.equal(getGardenCelebrationMessage("sprout"), "「芽」に育ちました！");
});

describe("fetchGardenGrowth", () => {
  test("RPCの結果から成長を作る", async () => {
    const calls: string[] = [];
    const client = {
      rpc: async (name: string) => {
        calls.push(name);
        return { data: [{ kind: "wear", day_count: 3 }], error: null };
      },
    };
    // @ts-expect-error テスト用のモック
    const result = await fetchGardenGrowth(client);
    assert.deepEqual(calls, ["get_closet_activity_kind_day_counts"]);
    assert.equal(result.ok && result.growth.stage.key, "sprout");
  });

  test("RPCのエラー（migration未適用など）・例外は ok:false", async () => {
    const originalError = console.error;
    console.error = () => {};
    try {
      const failing = { rpc: async () => ({ data: null, error: { code: "PGRST202" } }) };
      // @ts-expect-error テスト用のモック
      assert.deepEqual(await fetchGardenGrowth(failing), { ok: false });
      const throwing = {
        rpc: async () => {
          throw new Error("network");
        },
      };
      // @ts-expect-error テスト用のモック
      assert.deepEqual(await fetchGardenGrowth(throwing), { ok: false });
    } finally {
      console.error = originalError;
    }
  });
});
