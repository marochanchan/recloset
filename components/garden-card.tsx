import { GardenCharacter } from "@/components/garden-character";
import { GardenStageCelebration } from "@/components/garden-stage-celebration";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { GARDEN_GROWTH_KINDS, type GardenGrowth } from "@/lib/garden";
import {
  GARDEN_CARD_TITLE,
  GARDEN_KIND_LABELS,
  GARDEN_LEAD,
  GARDEN_LOAD_ERROR_MESSAGE,
  GARDEN_STAGE_LABELS,
  GARDEN_STORY_LINK_LABEL,
  getGardenNextStageMessage,
} from "@/lib/garden-copy";
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
      <Card className="flex flex-col gap-3 p-4">
        <div className="flex flex-col gap-1">
          <h2 id="garden-title" className="text-lg font-semibold">
            {GARDEN_CARD_TITLE}
          </h2>
          <p className="break-words text-xs text-muted-foreground">{GARDEN_LEAD}</p>
        </div>

        <GardenStageCelebration
          userId={userId}
          stageIndex={growth.stageIndex}
          stageKey={growth.stage.key}
        />

        {/* キャラクターを主役に、やわらかい背景の上に置く */}
        <div className="flex flex-col items-center gap-2 rounded-xl bg-muted/40 py-5">
          <GardenCharacter stageIndex={growth.stageIndex} />
          <p className="text-lg font-semibold">{stageLabel}</p>
          <p className="text-sm">
            累計{" "}
            <span className="text-2xl font-bold tabular-nums">{growth.totalPoints}</span>
            pt
          </p>
        </div>

        <div className="flex flex-col gap-2">
          {growth.nextStage && (
            <div
              role="progressbar"
              aria-label="次の段階までの進み具合"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percent}
              className="h-2 w-full overflow-hidden rounded-full bg-muted"
            >
              <div
                className="h-full rounded-full bg-primary motion-safe:transition-[width] motion-safe:duration-500"
                style={{ width: `${percent}%` }}
              />
            </div>
          )}
          <p className="break-words text-sm">{getGardenNextStageMessage(growth)}</p>
        </div>

        {/* 行動の種類ごとの内訳。スマホではキャラクターと進捗を優先して省く */}
        <dl className="hidden grid-cols-5 gap-1 border-t pt-3 text-center sm:grid">
          {GARDEN_GROWTH_KINDS.map((kind) => (
            <div key={kind} className="flex flex-col gap-0.5 rounded-md bg-muted/50 px-1 py-2">
              <dt className="text-[11px] text-muted-foreground">{GARDEN_KIND_LABELS[kind]}</dt>
              <dd className="text-sm font-semibold tabular-nums">
                {growth.pointsByKind[kind]}
                <span className="text-[10px] font-normal text-muted-foreground">pt</span>
              </dd>
            </div>
          ))}
        </dl>

        {/* 振り返りは Re:Story へ（育った理由＝これまでの行動を見られる） */}
        <Button
          asChild
          variant="outline"
          className="h-auto min-h-11 w-full whitespace-normal py-2 text-center active:bg-accent"
        >
          <Link href="/protected/story">
            <BookOpen aria-hidden="true" />
            {GARDEN_STORY_LINK_LABEL}
          </Link>
        </Button>
      </Card>
    </section>
  );
}

// 取得に失敗したとき（0ptと誤表示しない）
export function GardenError() {
  return (
    <section aria-labelledby="garden-title">
      <Card className="flex flex-col gap-2 p-4">
        <h2 id="garden-title" className="text-lg font-semibold">
          {GARDEN_CARD_TITLE}
        </h2>
        <p className="text-sm text-muted-foreground">{GARDEN_LOAD_ERROR_MESSAGE}</p>
      </Card>
    </section>
  );
}
