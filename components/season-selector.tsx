"use client";

import {
  getSeasonLabel,
  isAllSeasons,
  normalizeSeasons,
  SEASON_VALUES,
  type SeasonValue,
} from "@/lib/clothing-options";
import { cn } from "@/lib/utils";

// 季節の複数選択（春・夏・秋・冬のトグル＋オールシーズンのショートカット）。
// 何も選ばなければ未設定。値は常に 春→夏→秋→冬 の順に正規化して返す。

const chipClassName = (selected: boolean) =>
  cn(
    "inline-flex h-9 items-center rounded-full border px-4 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    selected
      ? "border-primary bg-primary font-medium text-primary-foreground"
      : "border-border bg-card text-muted-foreground hover:bg-accent hover:text-foreground",
  );

export function SeasonSelector({
  value,
  onChange,
  labelId,
  describedBy,
}: {
  value: SeasonValue[];
  onChange: (value: SeasonValue[]) => void;
  /** グループの見出し（ラベル）のid */
  labelId: string;
  /** 補足文・注意文のid */
  describedBy?: string;
}) {
  const allSelected = isAllSeasons(value);

  const toggle = (season: SeasonValue) => {
    onChange(
      normalizeSeasons(
        value.includes(season)
          ? value.filter((selected) => selected !== season)
          : [...value, season],
      ),
    );
  };

  return (
    <div
      role="group"
      aria-labelledby={labelId}
      aria-describedby={describedBy}
      className="flex flex-wrap gap-2"
    >
      {SEASON_VALUES.map((season) => {
        const selected = value.includes(season);
        return (
          <button
            key={season}
            type="button"
            aria-pressed={selected}
            onClick={() => toggle(season)}
            className={chipClassName(selected)}
          >
            {getSeasonLabel(season)}
          </button>
        );
      })}
      {/* 4季節すべてを選ぶショートカット（すべて選択中なら解除する） */}
      <button
        type="button"
        aria-pressed={allSelected}
        onClick={() => onChange(allSelected ? [] : [...SEASON_VALUES])}
        className={chipClassName(allSelected)}
      >
        オールシーズン
      </button>
    </div>
  );
}
