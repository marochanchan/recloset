import { GardenCharacter } from "@/components/garden-character";
import { GardenStageCelebration } from "@/components/garden-stage-celebration";
import { GARDEN_GROWTH_KINDS, GARDEN_STAGES, type GardenGrowth } from "@/lib/garden";
import {
  GARDEN_CARD_TITLE,
  GARDEN_KIND_LABELS,
  GARDEN_LEAD,
  GARDEN_LOAD_ERROR_MESSAGE,
  GARDEN_STAGE_LABELS,
  GARDEN_STORY_LINK_LABEL,
  getGardenNextStageMessage,
} from "@/lib/garden-copy";
import { cn } from "@/lib/utils";
import { BookOpen } from "lucide-react";
import Link from "next/link";

// Todayの「Re:Garden」。ふだんの行動で育つ植物キャラクター
// （今日の行動は Re:Quest、週の見直し目標は 今週のRe:Closet が担当する）。
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
      <div className="flex flex-col gap-4 rounded-3xl bg-gradient-to-b from-primary/5 to-primary/15 px-5 pb-5 pt-6">
        <div className="flex flex-col gap-1">
          <h2 id="garden-title" className="text-lg font-bold">
            {GARDEN_CARD_TITLE}
          </h2>
          <p className="break-words text-xs text-muted-foreground">{GARDEN_LEAD}</p>
        </div>

        <GardenStageCelebration
          userId={userId}
          stageIndex={growth.stageIndex}
          stageKey={growth.stage.key}
        />

        {/* キャラクターを主役に、足もとに淡い土の影を敷いて「庭に立つ」ように見せる */}
        <div className="flex flex-col items-center gap-1">
          <div className="relative flex justify-center">
            <span
              className="absolute bottom-2 h-5 w-32 rounded-[50%] bg-primary/15 blur-[2px]"
              aria-hidden="true"
            />
            <div className="relative">
              <GardenCharacter stageIndex={growth.stageIndex} />
            </div>
          </div>
          <p className="flex items-baseline gap-3">
            <span className="text-lg font-bold">{stageLabel}</span>
            <span className="text-sm text-muted-foreground">
              累計{" "}
              <span className="text-2xl font-bold tabular-nums text-foreground">
                {growth.totalPoints}
              </span>
              pt
            </span>
          </p>
        </div>

        {/* 次の段階までの進み具合（最後の段階では、育ち続けることだけを伝える） */}
        <div className="flex flex-col gap-2 rounded-2xl bg-card/80 px-4 py-3">
          <p className="break-words text-center text-sm">{getGardenNextStageMessage(growth)}</p>
          {growth.nextStage && (
            <div
              role="progressbar"
              aria-label="次の段階までの進み具合"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent}
              className="h-2 w-full overflow-hidden rounded-full bg-secondary"
            >
              <div
                className="h-full rounded-full bg-primary motion-safe:transition-[width] motion-safe:duration-500"
                style={{ width: `${percent}%` }}
              />
            </div>
          )}
        </div>

        {/* 6つの段階の道のり。育った段階はセージで塗り、今の段階を大きく示す */}
        <ol aria-label="成長の段階" className="relative grid grid-cols-6">
          <span
            className="absolute left-[8.33%] right-[8.33%] top-[7px] h-px bg-primary/25"
            aria-hidden="true"
          />
          {GARDEN_STAGES.map((stage, index) => {
            const isCurrent = index === growth.stageIndex;
            const isReached = index <= growth.stageIndex;
            return (
              <li
                key={stage.key}
                aria-current={isCurrent ? "step" : undefined}
                className="relative flex flex-col items-center gap-1.5"
              >
                <span
                  className={cn(
                    "rounded-full",
                    isCurrent
                      ? "h-4 w-4 bg-primary ring-4 ring-primary/20"
                      : isReached
                        ? "mt-0.5 h-3 w-3 bg-primary/60"
                        : "mt-0.5 h-3 w-3 border border-primary/40 bg-card",
                  )}
                  aria-hidden="true"
                />
                <span
                  className={cn(
                    "text-[11px]",
                    isCurrent ? "font-bold text-foreground" : "text-muted-foreground",
                  )}
                >
                  {GARDEN_STAGE_LABELS[stage.key]}
                  <span className="sr-only">
                    {isCurrent ? "（今の段階）" : isReached ? "（育った段階）" : ""}
                  </span>
                </span>
              </li>
            );
          })}
        </ol>

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

        {/* 振り返りは Re:Story へ（育った理由＝これまでの行動を見られる） */}
        <Link
          href="/protected/story"
          className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-card/80 px-4 py-2 text-center text-sm font-medium text-primary outline-none transition-colors hover:bg-card focus-visible:ring-2 focus-visible:ring-ring active:bg-card"
        >
          <BookOpen className="h-4 w-4 shrink-0" aria-hidden="true" />
          {GARDEN_STORY_LINK_LABEL}
        </Link>
      </div>
    </section>
  );
}

// 取得に失敗したとき（0ptと誤表示しない）
export function GardenError() {
  return (
    <section aria-labelledby="garden-title">
      <div className="flex flex-col gap-2 rounded-3xl bg-primary/5 px-5 py-6">
        <h2 id="garden-title" className="text-lg font-bold">
          {GARDEN_CARD_TITLE}
        </h2>
        <p className="text-sm text-muted-foreground">{GARDEN_LOAD_ERROR_MESSAGE}</p>
      </div>
    </section>
  );
}
