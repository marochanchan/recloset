import {
  NOT_WORN_REASON_OPTIONS,
  isAmbiguousFeeling,
  type DiagnosisDecisionChoice,
  type DiagnosisFact,
  type DiagnosisFeelingInput,
  type NotWornReason,
} from "@/lib/ai-diagnosis";

// ============================================================
// FACTガード（v1）
// Decisionを再判定するためではなく、Decisionの後に
// 状況と矛盾する行動を出さないためだけに使う固定バケット。
// 数値自体はユーザーには見せない。
// ============================================================

export type RecentWornBucket =
  | "recently_worn" // 0-7日
  | "normal" // 8-60日
  | "long_unworn" // 61日以上
  | "never_recorded"; // null

export function getRecentWornBucket(
  daysSinceLastWorn: number | null,
): RecentWornBucket {
  if (daysSinceLastWorn === null) return "never_recorded";
  if (daysSinceLastWorn <= 7) return "recently_worn";
  if (daysSinceLastWorn <= 60) return "normal";
  return "long_unworn";
}

// purchase_date（days_since_purchase）は補助FACTのため、Next Actionの
// 文言・分岐には使わない（「最近買ったから」「古いから」だけで提案を
// 変えない）。KEEP/RETRY/REBYEの判断自体への反映はJev側の指示で行う。

// ============================================================
// structured Next Action
// 将来Gemini（具体化・自然言語化・コーデ提案）に渡す入力の形を
// 見据えた、荒い分類（kind）＋根拠（reason/FACTバケット）＋
// v1で実際に表示するmessageの組。
// ============================================================

export type NextActionKind =
  | "keep_as_is" // KEEP
  | "reflect_recent_wear" // RETRY: 直近着用のため「振り返り」に切り替え
  | "try_once_first" // RETRY: never_recorded + 本人も迷っている（まず一度着てみる）
  | "wait_for_season" // RETRY: out_of_season（今は着るよう促さない）
  | "create_opportunity" // RETRY: long_unworn（機会を積極的に作る）
  | "small_trial" // RETRY: 通常の小さな試み
  | "review_as_candidate"; // REBYE

export type NextAction = {
  kind: NextActionKind;
  decision: DiagnosisDecisionChoice;
  primaryReason: NotWornReason | null;
  secondaryReason: NotWornReason | null;
  recentWornBucket: RecentWornBucket;
  /** 短い見出し。「ユーザーが次に何をするか」が分かる表現にする（Decisionの言い換えにしない）。 */
  title: string;
  message: string;
};

// 理由が複数ある場合に、どれを「主」とするかの優先順位（Next Action選定専用。
// Decisionの重みには使わない）。
const REASON_PRIORITY: NotWornReason[] = [
  "fit_or_comfort",
  "hard_to_style",
  "out_of_season",
  "no_occasion",
  "somehow_not_reaching_for_it",
  "other",
  "do_not_remember", // 排他的な選択肢のため単独でしか出現しない
];

function pickPrimaryAndSecondaryReason(reasons: NotWornReason[]): {
  primary: NotWornReason;
  secondary: NotWornReason | null;
} {
  const sorted = [...reasons].sort(
    (a, b) => REASON_PRIORITY.indexOf(a) - REASON_PRIORITY.indexOf(b),
  );
  return { primary: sorted[0], secondary: sorted[1] ?? null };
}

const KEEP_MESSAGE = "このまま大切に着ていきましょう。";

const REBYE_MESSAGE =
  "手放し候補として、少し時間をかけて考えてみましょう。他の似た服と比べてみたり、しばらく候補のまま様子を見てみましょう。";

// 本人の回答がまだ迷っている状態（isAmbiguousFeeling）でJevがREBYEを選んだ場合に、
// REBYE_MESSAGEの前に添えて「手放し候補＝今すぐ手放す決定」ではないことを明確にする。
// KEEP・RETRYは元のメッセージ自体が「今のまま」「試してみる」という結論を急がせない
// 内容のため、isAmbiguousFeelingとの意味の衝突が起きにくく、この前置きは追加しない。
const AMBIGUOUS_REBYE_PREFIX =
  "まだ迷いがあるようなので、今すぐ手放す必要はありません。";

const REFLECT_RECENT_WEAR_OUT_OF_SEASON_MESSAGE =
  "最近着たとき、どう感じましたか？今すぐ決めず、次に着られる季節になったときもう一度選びたいと思うか確かめてみましょう。";

const REFLECT_RECENT_WEAR_GENERIC_MESSAGE =
  "最近着たとき、どう感じましたか？その感覚を、次に考えるときの材料にしてみましょう。";

// RETRY・理由ごとの基本アクション（FACTガードによる上書きがない場合に使う）
const RETRY_REASON_MESSAGES: Record<NotWornReason, string> = {
  out_of_season: "着られる季節になったら、一度だけ着てみましょう。",
  no_occasion:
    "着られそうな場面を1つ具体的に考えてみましょう。思いつかなければ、手放し候補として少し様子を見てみましょう。",
  hard_to_style: "手持ちの服で新しい組み合わせを1つ試してみましょう。",
  fit_or_comfort:
    "一度袖を通して、サイズ・着心地の何が気になるか確認してみましょう。",
  somehow_not_reaching_for_it:
    "次に服を選ぶとき、意識してこの服を候補に入れてみましょう。",
  do_not_remember: "一度着て、着た後にどう感じたか確かめてみましょう。",
  other: "今の状況に合わせて、小さく試せることを1つ考えてみましょう。",
};

const RETRY_REASON_KIND: Record<NotWornReason, NextActionKind> = {
  out_of_season: "wait_for_season",
  no_occasion: "small_trial",
  hard_to_style: "small_trial",
  fit_or_comfort: "small_trial",
  somehow_not_reaching_for_it: "small_trial",
  do_not_remember: "small_trial",
  other: "small_trial",
};

// kindごとの短い見出し（「次に何をするか」が分かる表現。Decisionの言い換えにはしない）
const KEEP_TITLE = "このまま大切に着ていこう";
const REVIEW_AS_CANDIDATE_TITLE = "手放し候補として整理してみよう";
const REFLECT_RECENT_WEAR_TITLE = "最近着たときの気持ちを振り返ってみよう";
const WAIT_FOR_SEASON_TITLE = "次のシーズンでもう一度確かめよう";
const CREATE_OPPORTUNITY_TITLE = "一度着る機会をつくってみよう";
const TRY_ONCE_FIRST_TITLE = "一度着てみてから判断しよう";

// small_trial（RETRYの通常ケース）は理由ごとに短い見出しを出し分ける
const SMALL_TRIAL_TITLES: Record<NotWornReason, string> = {
  out_of_season: WAIT_FOR_SEASON_TITLE, // small_trial経由では通常使われない（安全のため定義）
  no_occasion: "着られる場面を見つけてみよう",
  hard_to_style: "新しい組み合わせを試してみよう",
  fit_or_comfort: "着心地を確かめてみよう",
  somehow_not_reaching_for_it: "次は意識して選んでみよう",
  do_not_remember: "着てみて感じを確かめよう",
  other: "小さく試してみよう",
};

// よく出そうな理由の組み合わせだけ個別テンプレートを持つ（v1では最小限）。
// キーは "主要理由|副次理由"。ここに無い組み合わせはフォールバックで統合する。
const REASON_COMBO_MESSAGES: Partial<Record<string, string>> = {
  "out_of_season|somehow_not_reaching_for_it":
    "季節が合わない上に、なんとなく手も伸びていない服のようです。次のシーズンまで保留して、着られる時期になったら一度だけ意識して選んでみましょう。それでも手が伸びなければ、そのときまた考えてみましょう。",
  "no_occasion|somehow_not_reaching_for_it":
    "着る場面が思い浮かばず、なんとなく手も伸びていない服のようです。次に近い機会があれば、まず候補に入れてみましょう。それでも思い浮かばなければ、手放し候補として少し様子を見てみましょう。",
};

function getReasonLabel(reason: NotWornReason): string {
  return (
    NOT_WORN_REASON_OPTIONS.find((option) => option.value === reason)
      ?.label ?? reason
  );
}

/**
 * 複数理由を1つの自然な行動プランに統合する。
 * よくある組み合わせは個別テンプレート、それ以外は
 * 主要理由のアクション＋副次理由を軽く添えるフォールバック。
 */
function mergeWithSecondaryReason(
  primary: NotWornReason,
  secondary: NotWornReason,
): string {
  const curated = REASON_COMBO_MESSAGES[`${primary}|${secondary}`];
  if (curated) return curated;

  return `${RETRY_REASON_MESSAGES[primary]}（${getReasonLabel(secondary)}というのも少し関係していそうです）`;
}

const LONG_UNWORN_SUFFIX =
  "しばらく着ていない分、実際に試してみると判断しやすくなりそうです。";

const TRY_ONCE_FIRST_MESSAGE =
  "Re:closetでの着用記録がまだなく、気持ちもまだ固まっていないようです。一度着てみて、そのときの気持ちを次に考える材料にしてみましょう。";

/**
 * Decision（Jevの結果）・FACT・FEELINGから、structuredなNext Actionを組み立てる。
 *
 * 重要: ここでの日数バケット判定はDecisionを上書きしない。
 * あくまで「Decisionと矛盾する行動を出さない」ためのガードとしてのみ使う。
 */
export function buildNextAction(
  decision: DiagnosisDecisionChoice,
  fact: DiagnosisFact,
  feeling: DiagnosisFeelingInput,
): NextAction {
  const recentWornBucket = getRecentWornBucket(fact.days_since_last_worn);

  if (decision === "KEEP") {
    return {
      kind: "keep_as_is",
      decision,
      primaryReason: null,
      secondaryReason: null,
      recentWornBucket,
      title: KEEP_TITLE,
      message: KEEP_MESSAGE,
    };
  }

  if (decision === "REBYE") {
    // 本人の気持ちがまだ固まっていない（isAmbiguousFeeling）のにREBYEが
    // 独立した結論のように見えると矛盾して見えるため、その場合だけ
    // 「今すぐ手放す必要はない」という前置きを添えて1つの文章にする。
    const message = isAmbiguousFeeling(feeling)
      ? `${AMBIGUOUS_REBYE_PREFIX}${REBYE_MESSAGE}`
      : REBYE_MESSAGE;

    return {
      kind: "review_as_candidate",
      decision,
      primaryReason: null,
      secondaryReason: null,
      recentWornBucket,
      title: REVIEW_AS_CANDIDATE_TITLE,
      message,
    };
  }

  // RETRY
  const { primary, secondary } = pickPrimaryAndSecondaryReason(
    feeling.notWornReasons,
  );

  let kind: NextActionKind;
  let title: string;
  let message: string;

  if (recentWornBucket === "recently_worn") {
    // 直近で着用済みのため、「もう一度着てみる」ではなく振り返りを優先する
    kind = "reflect_recent_wear";
    title = REFLECT_RECENT_WEAR_TITLE;
    message =
      primary === "out_of_season"
        ? REFLECT_RECENT_WEAR_OUT_OF_SEASON_MESSAGE
        : REFLECT_RECENT_WEAR_GENERIC_MESSAGE;
  } else if (recentWornBucket === "never_recorded" && isAmbiguousFeeling(feeling)) {
    // Re:closetでの着用記録がなく、本人もまだ迷っている場合は、
    // 判断を急がせず「まず一度着てみる」ことを提案する
    kind = "try_once_first";
    title = TRY_ONCE_FIRST_TITLE;
    message = TRY_ONCE_FIRST_MESSAGE;
  } else if (recentWornBucket === "long_unworn" && primary !== "out_of_season") {
    // 長期未着用の場合は、機会を積極的に作る方向へ強める
    // （out_of_seasonは季節を待つ方針を優先するため対象外）
    kind = "create_opportunity";
    title = CREATE_OPPORTUNITY_TITLE;
    message = `${RETRY_REASON_MESSAGES[primary]}${LONG_UNWORN_SUFFIX}`;
  } else {
    kind = RETRY_REASON_KIND[primary];
    title =
      primary === "out_of_season"
        ? WAIT_FOR_SEASON_TITLE
        : SMALL_TRIAL_TITLES[primary];
    message = secondary
      ? mergeWithSecondaryReason(primary, secondary)
      : RETRY_REASON_MESSAGES[primary];
  }

  return {
    kind,
    decision,
    primaryReason: primary,
    secondaryReason: secondary,
    recentWornBucket,
    title,
    message,
  };
}
