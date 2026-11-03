"use client";

import { BrandSuggestionChips } from "@/components/brand-suggestion-chips";
import { SeasonSelector } from "@/components/season-selector";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  buildCategoryUpdate,
  buildTitleSuggestions,
  classifyProgressReducer,
  getClassifyDoneMessage,
  INITIAL_CLASSIFY_PROGRESS,
  toSeasonsArrayLiteral,
  type ClassifyMode,
} from "@/lib/clothing-classify";
import { displayClothingTitle } from "@/lib/clothing-display-title";
import {
  CATEGORY_OPTIONS,
  COLOR_OPTIONS,
  getSubcategoryOptions,
  isSameSeasons,
  normalizeSeasons,
  PHOTO_ONLY_DISPLAY_LABEL,
  toLegacySeason,
  type SeasonValue,
} from "@/lib/clothing-options";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { DoodleBox, DoodleHanger } from "@/components/doodle-icons";
import { ChevronLeft } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useReducer, useRef, useState } from "react";

// ============================================================
// クイック仕分け（1着ずつ写真を大きく見せて、カテゴリ・種類・カラー・季節をタップで選ぶ。
// タイトル・ブランドは入力欄に入れる）
// - カテゴリ: 7つのボタンのどれかをタップすると保存して次へ
// - 季節: SeasonSelectorで選んで「保存して次へ」
// - 種類・カラー: ボタンをタップすると保存して次へ
// - タイトル・ブランド: 入力欄（カードの外）に入れて「保存して次へ」。入力欄にフォーカスが
//   ある間はスワイプ（スキップ）を受け付けない
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
  /** DBのタイトルそのもの（title は画面に出す表示名） */
  rawTitle: string;
  categoryClassifiedAt: string | null;
  mainColor: string | null;
  brand: string | null;
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
  brandSuggestions = [],
}: {
  mode: ClassifyMode;
  /** 仕分ける服（見せる順） */
  initialItems: ClassifyItem[];
  /** 前に入れたブランド（ブランドのモードだけ渡される） */
  brandSuggestions?: string[];
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
      prev.map((row) => {
        if (row.id !== item.id) return row;
        const merged = { ...row, ...next };
        // 種類・タイトルを保存したときは、カードの名前も一覧と同じ表示名にする
        // （カテゴリ・シーズンのときは今のまま変えない）
        return mode === "subcategory" || mode === "title"
          ? {
              ...merged,
              title: displayClothingTitle({
                title: merged.rawTitle,
                category: merged.category,
                subcategory: merged.subcategory,
                categoryClassifiedAt: merged.categoryClassifiedAt,
              }),
            }
          : merged;
      }),
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

  // 種類 / カラー / ブランド: 開始時（または前回保存時）から変わっていないときだけ上書きする
  const saveColumn = (
    column: "subcategory" | "main_color" | "brand",
    value: string,
  ) => {
    const item = current;
    if (!item) return;
    const field = column === "main_color" ? "mainColor" : column;
    const before = item[field];
    const alreadySaved = progress.savedIds.includes(item.id);
    void run(async () => {
      if (alreadySaved && value === before) {
        markSaved(item, {});
        return;
      }
      let query = createClient()
        .from("clothing_items")
        .update({ [column]: value })
        .eq("id", item.id);
      query = before === null ? query.is(column, null) : query.eq(column, before);
      // 種類は、カテゴリが変わっていないことも確かめる
      if (column === "subcategory") query = query.eq("category", item.category);
      const { data, error: updateError } = await query.select("id");
      if (updateError) {
        console.error(`save classify ${column} error:`, updateError);
        setError(SAVE_ERROR);
        return;
      }
      if (!data || data.length === 0) {
        setError(CONFLICT_ERROR);
        return;
      }
      markSaved(item, { [field]: value });
    });
  };

  const saveTitle = (rawValue: string) => {
    const item = current;
    if (!item) return;
    const title = rawValue.trim();
    if (!title) return;
    const alreadySaved = progress.savedIds.includes(item.id);
    void run(async () => {
      if (alreadySaved && title === item.rawTitle) {
        markSaved(item, {});
        return;
      }
      const { data, error: updateError } = await createClient()
        .from("clothing_items")
        .update({ title })
        .eq("id", item.id)
        // 開始時（または前回保存時）のタイトルから変わっていないときだけ上書きする
        .eq("title", item.rawTitle)
        .select("id");
      if (updateError) {
        console.error("save classify title error:", updateError);
        setError(SAVE_ERROR);
        return;
      }
      if (!data || data.length === 0) {
        setError(CONFLICT_ERROR);
        return;
      }
      markSaved(item, { rawTitle: title });
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
  // 入力欄にフォーカスがある間はスワイプを受け付けない（文字の選択の操作と取り合わないように）
  const textFocusedRef = useRef(false);

  const resetDrag = () => {
    dragRef.current = null;
    setDragX(0);
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (isBusy || !current || textFocusedRef.current) return;
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
        <p className="text-sm" aria-live="polite">
          <span className="text-lg font-semibold tabular-nums">{progress.index + 1}</span>
          <span className="text-muted-foreground"> / {total}着</span>
        </p>
        <p className="text-xs text-muted-foreground">
          仕分け済み {progress.savedIds.length}着
        </p>
      </div>
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-secondary"
        aria-hidden="true"
      >
        <div
          className="h-full rounded-full bg-primary transition-[width]"
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
            "overflow-hidden rounded-3xl border border-border/60 bg-card shadow-sm",
            dragX === 0 && "transition-transform duration-150",
            isBusy && "opacity-70",
          )}
          style={{
            transform: `translateX(${dragX}px) rotate(${dragX / 30}deg)`,
          }}
        >
          <div className="relative aspect-[4/5] max-h-[45vh] w-full bg-photo">
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
              <span className="flex h-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
                <DoodleHanger size={44} className="text-primary/50" />
                写真なし
              </span>
            )}
            {dragX !== 0 && (
              <span
                className="absolute right-4 top-4 rounded-lg border-2 border-muted-foreground bg-card/90 px-3 py-1 text-lg font-semibold text-muted-foreground"
                style={{ opacity: swipeStrength }}
                aria-hidden="true"
              >
                スキップ
              </span>
            )}
            {isCurrentSaved && (
              <span className="absolute left-3 top-3 rounded-full bg-primary px-2.5 py-0.5 text-xs font-medium text-primary-foreground">
                保存済み
              </span>
            )}
          </div>
          <p
            className={cn(
              "truncate px-4 py-2",
              current.title === PHOTO_ONLY_DISPLAY_LABEL
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
      ) : mode === "subcategory" ? (
        <OptionChoices
          labelText="種類をタップ（保存して次へ）"
          options={getSubcategoryOptions(current.category).map((o) => ({
            value: o.value,
            label: o.label,
          }))}
          columns="grid-cols-2"
          selected={isCurrentSaved ? current.subcategory : null}
          disabled={isBusy}
          onSelect={(value) => saveColumn("subcategory", value)}
        />
      ) : mode === "color" ? (
        <OptionChoices
          labelText="メインの色をタップ（保存して次へ）"
          options={COLOR_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
          columns="grid-cols-3"
          selected={isCurrentSaved ? current.mainColor : null}
          disabled={isBusy}
          onSelect={(value) => saveColumn("main_color", value)}
        />
      ) : mode === "season" ? (
        <SeasonChoices
          // 服が変わったら選択を作り直す
          key={current.id}
          initialSeasons={current.seasons}
          isSaved={isCurrentSaved}
          disabled={isBusy}
          onSave={saveSeasons}
        />
      ) : (
        <TextChoices
          // 服が変わったら入力欄を作り直す（戻ったときは保存した値を入れる）
          key={current.id}
          labelText={mode === "title" ? "タイトル" : "ブランド"}
          initialValue={
            isCurrentSaved ? (mode === "title" ? current.rawTitle : (current.brand ?? "")) : ""
          }
          isSaved={isCurrentSaved}
          disabled={isBusy}
          suggestions={mode === "title" ? buildTitleSuggestions(current) : null}
          brandSuggestions={mode === "brand" ? brandSuggestions : null}
          onFocusChange={(focused) => {
            textFocusedRef.current = focused;
            if (focused) resetDrag();
          }}
          onSave={mode === "title" ? saveTitle : (value) => saveColumn("brand", value.trim())}
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
        カテゴリをタップ（保存して次へ）
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

function OptionChoices({
  labelText,
  options,
  columns,
  selected,
  disabled,
  onSelect,
}: {
  labelText: string;
  options: { value: string; label: string }[];
  columns: string;
  /** 保存済みの値（戻ってきたときに強調する）。未保存ならnull */
  selected: string | null;
  disabled: boolean;
  onSelect: (value: string) => void;
}) {
  const labelId = useId();
  return (
    <div className="flex flex-col gap-2">
      <p id={labelId} className="text-sm font-medium">
        {labelText}
      </p>
      <div role="group" aria-labelledby={labelId} className={cn("grid gap-2", columns)}>
        {options.map((option) => (
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

// タイトル・ブランドの入力。Enter でも「保存して次へ」と同じ動き
function TextChoices({
  labelText,
  initialValue,
  isSaved,
  disabled,
  suggestions,
  brandSuggestions,
  onFocusChange,
  onSave,
}: {
  labelText: string;
  initialValue: string;
  isSaved: boolean;
  disabled: boolean;
  /** タイトルの候補（タイトルのモードだけ） */
  suggestions: string[] | null;
  /** 前に入れたブランド（ブランドのモードだけ） */
  brandSuggestions: string[] | null;
  onFocusChange: (focused: boolean) => void;
  onSave: (value: string) => void;
}) {
  const [value, setValue] = useState(initialValue);
  const inputId = useId();
  const canSave = value.trim().length > 0;
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (canSave && !disabled) onSave(value);
      }}
    >
      <label htmlFor={inputId} className="text-sm font-medium">
        {labelText}
      </label>
      <Input
        id={inputId}
        type="text"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onFocus={() => onFocusChange(true)}
        onBlur={() => onFocusChange(false)}
        autoComplete="off"
        enterKeyHint="done"
      />
      {suggestions && suggestions.length > 0 && (
        <div className="flex flex-wrap gap-2" role="group" aria-label="タイトルの候補">
          {suggestions.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              disabled={disabled}
              onClick={() => setValue(suggestion)}
              className="inline-flex h-8 items-center rounded-full border bg-background px-3 text-sm transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            >
              {suggestion}
            </button>
          ))}
        </div>
      )}
      {brandSuggestions && (
        <BrandSuggestionChips
          suggestions={brandSuggestions}
          input={value}
          onSelect={setValue}
          disabled={disabled}
        />
      )}
      <Button type="submit" size="lg" className="min-h-12" disabled={disabled || !canSave}>
        {isSaved ? "選び直して保存" : "保存して次へ"}
      </Button>
    </form>
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
        着るシーズンを選ぶ（複数OK）
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

const CONTINUE_LABELS: Record<ClassifyMode, string> = {
  category: "カテゴリをもう少し仕分ける",
  subcategory: "種類をもう少し仕分ける",
  color: "カラーをもう少し仕分ける",
  season: "シーズンをもう少し仕分ける",
  title: "タイトルをもう少し付ける",
  brand: "ブランドをもう少し入れる",
};

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
      <div className="flex flex-col items-center gap-1 rounded-3xl bg-gradient-to-b from-primary/10 to-blush/20 px-5 py-8 text-center">
        <DoodleBox size={40} className="mb-2 text-primary" />
        <p className="text-lg font-semibold">
          {savedCount > 0 ? "おつかれさまでした" : "ここまでにしました"}
        </p>
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {getClassifyDoneMessage(savedCount)}
        </p>
      </div>
      <div className="flex flex-col gap-2">
        <Button asChild className="min-h-11">
          <Link href="/protected/items">
            <DoodleHanger />
            クローゼットに戻る
          </Link>
        </Button>
        <Button
          type="button"
          variant="outline"
          className="min-h-11"
          onClick={onContinue}
        >
          {CONTINUE_LABELS[mode]}
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
