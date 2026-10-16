"use client";

import { SeasonSelector } from "@/components/season-selector";
import { Button } from "@/components/ui/button";
import {
  buildCategoryUpdate,
  classifyProgressReducer,
  getClassifyDoneMessage,
  INITIAL_CLASSIFY_PROGRESS,
  toSeasonsArrayLiteral,
  type ClassifyMode,
} from "@/lib/clothing-classify";
import {
  CATEGORY_OPTIONS,
  isSameSeasons,
  normalizeSeasons,
  PHOTO_ONLY_TITLE,
  toLegacySeason,
  type SeasonValue,
} from "@/lib/clothing-options";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { ChevronLeft } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useReducer, useRef, useState } from "react";

// ============================================================
// クイック仕分け（1着ずつ写真を大きく見せて、カテゴリか季節をタップで選ぶ）
// - カテゴリ: 7つのボタンのどれかをタップすると保存して次へ
// - 季節: SeasonSelectorで選んで「保存して次へ」
// - 1着ごとに clothing_items へ保存する。途中でやめても保存した分は残る
// - 戻る: 前の服を再表示するだけ（保存済みの分類は取り消さない。選び直せば上書き保存）
// - 左スワイプ＝スキップ。縦スクロールはブラウザに任せる（touch-action: pan-y）
// - カテゴリを保存すると category_classified_at も記録する（「その他」でも次回は出ない）
// - 保存前の値が変わっていたら（別の画面で編集された等）保存しない
// - 服の一覧は開始時に固定する（「その他」を選んだ服が同じ回で再び出ないように）
// ============================================================

export type ClassifyItem = {
  id: string;
  title: string;
  imageUrl: string | null;
  category: string;
  subcategory: string | null;
  seasons: SeasonValue[];
};

// これ以上左に動かして離したらスキップする（px）
const SWIPE_THRESHOLD = 80;
// 指を置いてから、横の動きとしてカードを動かし始める距離（px）
const DRAG_START_DISTANCE = 8;

const SAVE_ERROR = "保存できませんでした。もう一度お試しください";
const CONFLICT_ERROR =
  "ほかの画面で変更されたため保存しませんでした。スキップして次へ進めます";

export function ClothingClassifySession({
  mode,
  initialItems,
}: {
  mode: ClassifyMode;
  /** 仕分ける服（見せる順） */
  initialItems: ClassifyItem[];
}) {
  const router = useRouter();
  // 保存した値は手元の一覧にも反映する（戻ったときの表示と、次の保存前の確認に使う）
  const [items, setItems] = useState(initialItems);
  const [progress, dispatch] = useReducer(
    classifyProgressReducer,
    INITIAL_CLASSIFY_PROGRESS,
  );
  const [isBusy, setIsBusy] = useState(false);
  // 二重送信の防止。stateは次の描画まで反映されないため、refを併用する
  const busyRef = useRef(false);
  const [error, setError] = useState<string | null>(null);

  const total = items.length;
  const current = items[progress.index] ?? null;
  const isCurrentSaved = current ? progress.savedIds.includes(current.id) : false;

  const run = async (task: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setIsBusy(true);
    setError(null);
    try {
      await task();
    } catch (taskError) {
      // 通信エラーなどの例外。同じ服のまま、もう一度選べる
      console.error("save classify error:", taskError);
      setError(SAVE_ERROR);
    } finally {
      busyRef.current = false;
      setIsBusy(false);
    }
  };

  const markSaved = (item: ClassifyItem, next: Partial<ClassifyItem>) => {
    setItems((prev) =>
      prev.map((row) => (row.id === item.id ? { ...row, ...next } : row)),
    );
    dispatch({ type: "saved", itemId: item.id, total });
  };

  const saveCategory = (category: string) => {
    const item = current;
    if (!item) return;
    const alreadySaved = progress.savedIds.includes(item.id);
    void run(async () => {
      // 戻ってきて同じカテゴリを選んだときは書き込まない（保存済みのまま次へ）。
      // 未保存の服は「その他」のままでも保存して、分類した日時を記録する
      if (alreadySaved && category === item.category) {
        markSaved(item, {});
        return;
      }
      const update = buildCategoryUpdate(item, category, new Date());
      const { data, error: updateError } = await createClient()
        .from("clothing_items")
        .update(update)
        .eq("id", item.id)
        // 開始時（または前回保存時）から変わっていないときだけ上書きする
        .eq("category", item.category)
        .select("id");
      if (updateError) {
        console.error("save classify category error:", updateError);
        setError(SAVE_ERROR);
        return;
      }
      if (!data || data.length === 0) {
        setError(CONFLICT_ERROR);
        return;
      }
      markSaved(item, {
        category: update.category,
        subcategory: update.subcategory,
      });
    });
  };

  const saveSeasons = (selected: SeasonValue[]) => {
    const item = current;
    if (!item) return;
    const seasons = normalizeSeasons(selected);
    if (seasons.length === 0) return;
    void run(async () => {
      if (isSameSeasons(seasons, item.seasons)) {
        markSaved(item, {});
        return;
      }
      const { data, error: updateError } = await createClient()
        .from("clothing_items")
        // 旧 season 列（単一値）も同時に書く（migration 012 の互換方針）
        .update({ seasons, season: toLegacySeason(seasons) })
        .eq("id", item.id)
        .filter("seasons", "eq", toSeasonsArrayLiteral(item.seasons))
        .select("id");
      if (updateError) {
        console.error("save classify seasons error:", updateError);
        setError(SAVE_ERROR);
        return;
      }
      if (!data || data.length === 0) {
        setError(CONFLICT_ERROR);
        return;
      }
      markSaved(item, { seasons });
    });
  };

  const goNext = () => {
    if (!current || busyRef.current) return;
    setError(null);
    dispatch({ type: "next", total });
  };

  const goBack = () => {
    if (busyRef.current) return;
    setError(null);
    dispatch({ type: "back" });
  };

  const finish = () => {
    if (busyRef.current) return;
    setError(null);
    dispatch({ type: "finish", total });
  };

  // ---- スワイプ（左だけ。スキップ） ----
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    isHorizontal: boolean;
  } | null>(null);
  const [dragX, setDragX] = useState(0);

  const resetDrag = () => {
    dragRef.current = null;
    setDragX(0);
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (isBusy || !current) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      isHorizontal: false,
    };
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.isHorizontal) {
      if (Math.abs(dx) < DRAG_START_DISTANCE) return;
      // 縦の動きが大きいときはスワイプにしない（スクロールに任せる）
      if (Math.abs(dy) > Math.abs(dx)) {
        resetDrag();
        return;
      }
      drag.isHorizontal = true;
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    // 右には動かさない（右スワイプには操作を割り当てていない）
    setDragX(Math.min(dx, 0));
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = drag.isHorizontal ? event.clientX - drag.startX : 0;
    resetDrag();
    if (dx <= -SWIPE_THRESHOLD) goNext();
  };

  if (!current) {
    return (
      <ClassifyDone
        mode={mode}
        savedCount={progress.savedIds.length}
        canGoBack={total > 0}
        onBack={goBack}
        onContinue={() =>
          router.push(`/protected/items/classify?mode=${mode}&r=${Date.now()}`)
        }
      />
    );
  }

  const swipeStrength = Math.min(Math.abs(dragX) / SWIPE_THRESHOLD, 1);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium" aria-live="polite">
          {progress.index + 1} / {total}着
        </p>
        <p className="text-xs text-muted-foreground">
          仕分け済み {progress.savedIds.length}着
        </p>
      </div>
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
        aria-hidden="true"
      >
        <div
          className="h-full bg-primary transition-[width]"
          style={{ width: `${(progress.index / total) * 100}%` }}
        />
      </div>

      {/* 写真のカード。左への動きだけをスワイプ（スキップ）として受け取る */}
      <div
        className="relative touch-pan-y select-none"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={resetDrag}
      >
        <div
          className={cn(
            "overflow-hidden rounded-xl border bg-background shadow-sm",
            dragX === 0 && "transition-transform duration-150",
            isBusy && "opacity-70",
          )}
          style={{
            transform: `translateX(${dragX}px) rotate(${dragX / 30}deg)`,
          }}
        >
          <div className="relative aspect-[4/5] max-h-[45vh] w-full bg-muted">
            {current.imageUrl ? (
              <Image
                key={current.id}
                src={current.imageUrl}
                alt={current.title}
                fill
                priority
                draggable={false}
                sizes="(min-width: 640px) 28rem, 100vw"
                className="pointer-events-none object-contain"
                style={{ objectFit: "contain" }}
              />
            ) : (
              <span className="flex h-full items-center justify-center text-sm text-muted-foreground">
                写真なし
              </span>
            )}
            {dragX !== 0 && (
              <span
                className="absolute right-4 top-4 rounded-md border-2 border-muted-foreground bg-background/90 px-3 py-1 text-lg font-bold text-muted-foreground"
                style={{ opacity: swipeStrength }}
                aria-hidden="true"
              >
                スキップ
              </span>
            )}
            {isCurrentSaved && (
              <span className="absolute left-3 top-3 rounded-full bg-background/90 px-2.5 py-0.5 text-xs font-medium">
                保存済み
              </span>
            )}
          </div>
          <p
            className={cn(
              "truncate px-4 py-2",
              current.title === PHOTO_ONLY_TITLE
                ? "text-sm text-muted-foreground"
                : "font-medium",
            )}
          >
            {current.title}
          </p>
        </div>
      </div>

      {mode === "category" ? (
        <CategoryChoices
          selected={isCurrentSaved ? current.category : null}
          disabled={isBusy}
          onSelect={saveCategory}
        />
      ) : (
        <SeasonChoices
          // 服が変わったら選択を作り直す
          key={current.id}
          initialSeasons={current.seasons}
          isSaved={isCurrentSaved}
          disabled={isBusy}
          onSave={saveSeasons}
        />
      )}
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      <div className="grid grid-cols-2 gap-2">
        <Button
          type="button"
          variant="outline"
          className="min-h-11"
          onClick={goBack}
          disabled={isBusy || progress.index === 0}
        >
          <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          戻る
        </Button>
        <Button
          type="button"
          variant="outline"
          className="min-h-11"
          onClick={goNext}
          disabled={isBusy}
        >
          {isCurrentSaved ? "次へ →" : "スキップ →"}
        </Button>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="self-center text-muted-foreground"
        onClick={finish}
        disabled={isBusy}
      >
        ここで終える
      </Button>
      <p className="text-xs text-muted-foreground">
        1着ごとに保存されます。途中でやめても、仕分けた分はそのまま残ります。
      </p>
    </div>
  );
}

function CategoryChoices({
  selected,
  disabled,
  onSelect,
}: {
  /** 保存済みのカテゴリ（戻ってきたときに強調する）。未保存ならnull */
  selected: string | null;
  disabled: boolean;
  onSelect: (category: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <p id="classify-category-label" className="text-sm font-medium">
        カテゴリをタップ（すぐに保存して次へ進みます）
      </p>
      <div
        role="group"
        aria-labelledby="classify-category-label"
        className="grid grid-cols-3 gap-2"
      >
        {CATEGORY_OPTIONS.map((option) => (
          <Button
            key={option.value}
            type="button"
            variant={selected === option.value ? "default" : "outline"}
            aria-pressed={selected === option.value}
            className="min-h-12 px-2"
            disabled={disabled}
            onClick={() => onSelect(option.value)}
          >
            {option.label}
          </Button>
        ))}
      </div>
    </div>
  );
}

function SeasonChoices({
  initialSeasons,
  isSaved,
  disabled,
  onSave,
}: {
  initialSeasons: SeasonValue[];
  isSaved: boolean;
  disabled: boolean;
  onSave: (seasons: SeasonValue[]) => void;
}) {
  const [seasons, setSeasons] = useState<SeasonValue[]>(initialSeasons);
  return (
    <div className="flex flex-col gap-3">
      <p id="classify-season-label" className="text-sm font-medium">
        着る季節を選ぶ（複数選べます）
      </p>
      <SeasonSelector
        value={seasons}
        onChange={setSeasons}
        labelId="classify-season-label"
      />
      <Button
        type="button"
        size="lg"
        className="min-h-12"
        disabled={disabled || seasons.length === 0}
        onClick={() => onSave(seasons)}
      >
        {isSaved ? "選び直して保存" : "保存して次へ"}
      </Button>
    </div>
  );
}

function ClassifyDone({
  mode,
  savedCount,
  canGoBack,
  onBack,
  onContinue,
}: {
  mode: ClassifyMode;
  savedCount: number;
  canGoBack: boolean;
  onBack: () => void;
  onContinue: () => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1 rounded-lg border p-5 text-center">
        <p className="text-lg font-bold">
          {savedCount > 0 ? "おつかれさまでした" : "ここまでにしました"}
        </p>
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {getClassifyDoneMessage(savedCount)}
        </p>
      </div>
      <div className="flex flex-col gap-2">
        <Button asChild className="min-h-11">
          <Link href="/protected/items">クローゼットに戻る</Link>
        </Button>
        <Button
          type="button"
          variant="outline"
          className="min-h-11"
          onClick={onContinue}
        >
          {mode === "category" ? "カテゴリをもう少し仕分ける" : "季節をもう少し仕分ける"}
        </Button>
        <Button asChild variant="ghost" size="sm">
          <Link href="/protected/items/classify">仕分けメニューへ</Link>
        </Button>
        {canGoBack && (
          <Button type="button" variant="ghost" size="sm" onClick={onBack}>
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            最後の服に戻る
          </Button>
        )}
      </div>
    </div>
  );
}
