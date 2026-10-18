import { DoodleSprout } from "@/components/doodle-icons";
import { GardenCharacter } from "@/components/garden-character";
import { GardenStageCelebration } from "@/components/garden-stage-celebration";
import { GARDEN_GROWTH_KINDS, GARDEN_STAGES, type GardenGrowth } from "@/lib/garden";
import {
  GARDEN_CARD_TITLE,
  GARDEN_KIND_LABELS,
  GARDEN_LOAD_ERROR_MESSAGE,
  GARDEN_STAGE_LABELS,
  getGardenNextStageMessage,
} from "@/lib/garden-copy";
import { cn } from "@/lib/utils";

// Todayの「Re:Garden」。ふだんの行動で育つ植物キャラクター
// （今日の行動は Re:Quest、週の見直し目標は 今週のRe:Closet が担当する）。
// Re:Questのすぐ下に置くため、キャラクターと進み具合を横並びにしたコンパクトな庭にする。
// 振り返り（Re:Story）はTodayのアイコンの導線から開く。
// ポイントは減らさない。手放しもほかの行動と同じ1ptとして扱う
export function GardenCard({
  growth,
  userId,
}: {
  growth: GardenGrowth;
  /** ログイン中のユーザーID（成長のお祝いの記録をユーザーごとに分ける） */
  userId: string | null;
}) {
  const percent = Math.round(growth.progressToNextStage * 100);
  const stageLabel = GARDEN_STAGE_LABELS[growth.stage.key];

  return (
    <section aria-labelledby="garden-title">
      {/* 枠線の代わりに、セージの淡いグラデーションで「小さな庭」をつくる */}
      <div className="flex flex-col gap-3 rounded-3xl bg-gradient-to-br from-primary/5 to-primary/15 p-4">
        <GardenStageCelebration
          userId={userId}
          stageIndex={growth.stageIndex}
          stageKey={growth.stage.key}
        />

        <div className="flex items-center gap-4">
          {/* キャラクターの足もとに淡い土の影を敷いて「庭に立つ」ように見せる */}
          <div className="relative flex shrink-0 justify-center">
            <span
              className="absolute bottom-1 h-4 w-24 rounded-[50%] bg-primary/15 blur-[2px]"
              aria-hidden="true"
            />
            <div className="relative">
              <GardenCharacter stageIndex={growth.stageIndex} size={112} />
            </div>
          </div>

          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <h2
              id="garden-title"
              className="flex items-center gap-1.5 text-sm font-semibold text-primary"
            >
              <DoodleSprout size={18} />
              {GARDEN_CARD_TITLE}
            </h2>
            <p className="flex flex-wrap items-baseline gap-x-2">
              <span className="text-xl font-semibold">{stageLabel}</span>
              <span className="text-xs text-muted-foreground">
                <span className="text-lg font-semibold tabular-nums text-foreground">
                  {growth.totalPoints}
                </span>
                pt
              </span>
            </p>
            {/* 次の段階までの進み具合（最後の段階では、育ち続けることだけを伝える） */}
            {growth.nextStage && (
              <div
                role="progressbar"
                aria-label="次の段階までの進み具合"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={percent}
                className="h-1.5 w-full overflow-hidden rounded-full bg-card"
              >
                <div
                  className="h-full rounded-full bg-primary motion-safe:transition-[width] motion-safe:duration-500"
                  style={{ width: `${percent}%` }}
                />
              </div>
            )}
            <p className="break-words text-xs text-muted-foreground">
              {getGardenNextStageMessage(growth)}
            </p>
            {/* 6つの段階の道のり（段階名は今の段階だけ上に表示し、ここでは点で示す） */}
            <ol aria-label="成長の段階" className="flex items-center gap-1.5">
              {GARDEN_STAGES.map((stage, index) => {
                const isCurrent = index === growth.stageIndex;
                const isReached = index <= growth.stageIndex;
                return (
                  <li
                    key={stage.key}
                    aria-current={isCurrent ? "step" : undefined}
                    className="flex"
                  >
                    <span
                      className={cn(
                        "rounded-full",
                        isCurrent
                          ? "h-2.5 w-5 bg-primary"
                          : isReached
                            ? "h-2 w-2 bg-primary/60"
                            : "h-2 w-2 border border-primary/40 bg-card",
                      )}
                      aria-hidden="true"
                    />
                    <span className="sr-only">
                      {GARDEN_STAGE_LABELS[stage.key]}
                      {isCurrent ? "（今の段階）" : isReached ? "（育った段階）" : ""}
                    </span>
                  </li>
                );
              })}
            </ol>
          </div>
        </div>

        {/* 行動の種類ごとの内訳。スマホではキャラクターと進捗を優先して省く */}
        <dl className="hidden grid-cols-5 gap-1 text-center sm:grid">
          {GARDEN_GROWTH_KINDS.map((kind) => (
            <div key={kind} className="flex flex-col gap-0.5 rounded-xl bg-card/70 px-1 py-2">
              <dt className="text-[11px] text-muted-foreground">{GARDEN_KIND_LABELS[kind]}</dt>
              <dd className="text-sm font-semibold tabular-nums">
                {growth.pointsByKind[kind]}
                <span className="text-[10px] font-normal text-muted-foreground">pt</span>
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}

// 取得に失敗したとき（0ptと誤表示しない）
export function GardenError() {
  return (
    <section aria-labelledby="garden-title">
      <div className="flex flex-col gap-2 rounded-3xl bg-primary/5 p-4">
        <h2
          id="garden-title"
          className="flex items-center gap-1.5 text-sm font-semibold text-primary"
        >
          <DoodleSprout size={18} />
          {GARDEN_CARD_TITLE}
        </h2>
        <p className="text-sm text-muted-foreground">{GARDEN_LOAD_ERROR_MESSAGE}</p>
      </div>
    </section>
  );
}
