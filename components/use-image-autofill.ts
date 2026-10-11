"use client";

import { analyzeClothingImageForAutofill } from "@/app/(main)/protected/items/new/actions";
import {
  isSameSeasons,
  isSubcategoryForCategory,
  type SeasonValue,
} from "@/lib/clothing-options";
import { processImageForAnalysis, type ImageRotation } from "@/lib/image-processing";
import { useCallback, useEffect, useRef, useState } from "react";

// ============================================================
// 登録フォームの「写真から自動入力」（タイトル・カテゴリー・種類・メインカラー・季節）。
//
// - 代表画像（並び順の先頭）1枚だけを解析する
// - 解析対象は「画像のkey＋回転」で識別し、今の対象と違う結果は反映しない
//   （解析中に画像を差し替えた・回転した場合に古い結果を入れないため）
// - 自動で解析するのは画像ごとに1回だけ。回転後・失敗後はボタンで再実行する
// - 解析に成功した対象はもう一度送らない（同じ画像で無駄なリクエストをしない）
// - 入力するのは「空」か「前回AIが入れた値のまま」の項目だけ。
//   ユーザーが入力・修正した値は上書きしない
// - 項目は AutofillValues に定義する
// - 種類は、カテゴリーを入れた後の値に属する場合だけ入れる（矛盾させない）
// ============================================================

/** 自動入力できる項目と、その値の型 */
export type AutofillValues = {
  title: string;
  category: string;
  /** 種類（空文字は未設定） */
  subcategory: string;
  /** メインカラー（空文字は未設定） */
  mainColor: string;
  seasons: SeasonValue[];
};

export type AutofillField = keyof AutofillValues;

/** フォームの項目（現在値と更新関数） */
export type AutofillFieldBindings = {
  [K in AutofillField]: {
    value: AutofillValues[K];
    set: (value: AutofillValues[K]) => void;
  };
};

// 項目ごとの「空」と「同じ値」の判定。並び順が入力する順番
// （種類はカテゴリーの値を見て判定するため、カテゴリーより後に置く）
const FIELD_RULES: {
  [K in AutofillField]: {
    isEmpty: (value: AutofillValues[K]) => boolean;
    isSame: (a: AutofillValues[K], b: AutofillValues[K]) => boolean;
  };
} = {
  title: { isEmpty: (v) => v.trim() === "", isSame: (a, b) => a === b },
  category: { isEmpty: (v) => v === "", isSame: (a, b) => a === b },
  subcategory: { isEmpty: (v) => v === "", isSame: (a, b) => a === b },
  mainColor: { isEmpty: (v) => v === "", isSame: (a, b) => a === b },
  seasons: { isEmpty: (v) => v.length === 0, isSame: isSameSeasons },
};

const AUTOFILL_FIELDS = Object.keys(FIELD_RULES) as AutofillField[];

/** 代表画像（新しく選び、縮小処理が終わったもの） */
export type AutofillTarget = {
  key: string;
  rotation: ImageRotation;
  sourceFile: File;
};

export type AutofillStatus =
  | { kind: "idle" }
  | { kind: "analyzing" }
  | { kind: "filled"; fields: AutofillField[] }
  | { kind: "nothing_to_fill" }
  | { kind: "not_clothing" }
  | { kind: "error"; message: string };

// 画像を選んだ直後の回転・並び替えをまとめるため、少し待ってから自動解析する
const AUTO_ANALYZE_DELAY_MS = 800;

const getTargetId = (target: AutofillTarget) =>
  `${target.key}:${target.rotation}`;

export function useImageAutofill({
  enabled,
  target,
  fields,
}: {
  /** 新規登録のときだけtrue */
  enabled: boolean;
  target: AutofillTarget | null;
  fields: AutofillFieldBindings;
}) {
  const [status, setStatus] = useState<AutofillStatus>({ kind: "idle" });
  // AIが最後に入れた値（ユーザーが変えていなければ、次の結果で更新してよい）
  const [aiValues, setAiValues] = useState<Partial<AutofillValues>>({});
  // AIが「確認してほしい」とした項目（確信度が低いなど）
  const [needsCheckFields, setNeedsCheckFields] = useState<AutofillField[]>([]);

  // 非同期の結果を受け取った時点の最新値を参照するためのref
  const latest = useRef({ fields, aiValues, targetId: "" });
  latest.current = {
    fields,
    aiValues,
    targetId: target ? getTargetId(target) : "",
  };

  const completedTargetIds = useRef<Set<string>>(new Set());
  const autoAnalyzedKeys = useRef<Set<string>>(new Set());
  const [analyzingTargetId, setAnalyzingTargetId] = useState<string | null>(
    null,
  );

  const analyze = useCallback(async (analysisTarget: AutofillTarget) => {
    const targetId = getTargetId(analysisTarget);
    if (completedTargetIds.current.has(targetId)) return;

    setAnalyzingTargetId(targetId);
    setStatus({ kind: "analyzing" });

    // 今の対象と違う（古い）結果は捨てる
    const isStale = () => latest.current.targetId !== targetId;

    try {
      const { blob } = await processImageForAnalysis(
        analysisTarget.sourceFile,
        analysisTarget.rotation,
      );
      if (isStale()) return;

      const formData = new FormData();
      formData.append("image", blob, "image.jpg");
      const result = await analyzeClothingImageForAutofill(formData);
      if (isStale()) return;

      if (!result.ok) {
        setStatus({ kind: "error", message: result.error });
        return;
      }
      completedTargetIds.current.add(targetId);

      if (!result.isClothing) {
        setStatus({ kind: "not_clothing" });
        return;
      }

      // AIの候補（値がないもの・判定できなかったものは入れない）
      const suggestions: Partial<AutofillValues> = {};
      if (result.title) suggestions.title = result.title;
      if (result.category) suggestions.category = result.category;
      if (result.subcategory) suggestions.subcategory = result.subcategory;
      if (result.mainColor) suggestions.mainColor = result.mainColor;
      if (result.seasons && result.seasons.length > 0) {
        suggestions.seasons = result.seasons;
      }

      const current = latest.current;
      const filled: AutofillField[] = [];
      const nextAiValues: Partial<AutofillValues> = { ...current.aiValues };
      // 種類の判定に使う「入力後のカテゴリー」
      let effectiveCategory = current.fields.category.value;

      const fillField = <K extends AutofillField>(field: K) => {
        const suggestion = suggestions[field] as AutofillValues[K] | undefined;
        if (suggestion === undefined) return;
        const rules = FIELD_RULES[field];
        const binding = current.fields[field];
        const previousAiValue = current.aiValues[field] as
          | AutofillValues[K]
          | undefined;
        const canFill =
          rules.isEmpty(binding.value) ||
          (previousAiValue !== undefined &&
            rules.isSame(binding.value, previousAiValue));
        if (!canFill) return;
        // ユーザーが選んだカテゴリーに属さない種類は入れない
        if (
          field === "subcategory" &&
          !isSubcategoryForCategory(effectiveCategory, suggestion)
        ) {
          return;
        }
        binding.set(suggestion);
        nextAiValues[field] = suggestion;
        filled.push(field);
        if (field === "category") effectiveCategory = suggestion as string;
      };
      for (const field of AUTOFILL_FIELDS) fillField(field);

      setAiValues(nextAiValues);
      setNeedsCheckFields(result.needsCheck);
      setStatus(
        filled.length > 0
          ? { kind: "filled", fields: filled }
          : { kind: "nothing_to_fill" },
      );
    } catch (error) {
      if (isStale()) return;
      console.error("image autofill failed:", error);
      setStatus({
        kind: "error",
        message: "写真から読み取れませんでした。そのまま入力して登録できます",
      });
    } finally {
      setAnalyzingTargetId((currentId) =>
        currentId === targetId ? null : currentId,
      );
    }
  }, []);

  const targetId = target ? getTargetId(target) : null;

  // 代表画像が決まったら、その画像（key）で1回だけ自動解析する
  useEffect(() => {
    if (!enabled || !target) return;
    if (autoAnalyzedKeys.current.has(target.key)) return;

    const timer = window.setTimeout(() => {
      autoAnalyzedKeys.current.add(target.key);
      void analyze(target);
    }, AUTO_ANALYZE_DELAY_MS);
    return () => window.clearTimeout(timer);
    // targetIdが変わったとき（画像の差し替え・回転）だけ判定し直す
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, targetId, analyze]);

  // 代表画像がなくなったら、表示中の結果・エラーを消す
  useEffect(() => {
    if (!targetId) setStatus({ kind: "idle" });
  }, [targetId]);

  const isAnalyzing = analyzingTargetId !== null && analyzingTargetId === targetId;
  // 今の代表画像をまだ解析し終えていない（回転後・失敗後など）ときだけ再実行できる
  const canAnalyze =
    enabled &&
    target !== null &&
    !isAnalyzing &&
    !completedTargetIds.current.has(getTargetId(target));

  // 解析中に代表画像が変わった場合、古い解析の「読み取り中」は表示しない
  const visibleStatus: AutofillStatus = isAnalyzing
    ? { kind: "analyzing" }
    : status.kind === "analyzing"
      ? { kind: "idle" }
      : status;

  /** 今の値がAIの入れた値のままか（ユーザーが修正していないか） */
  const isAiValue = <K extends AutofillField>(field: K): boolean => {
    const aiValue = aiValues[field] as AutofillValues[K] | undefined;
    const rules = FIELD_RULES[field];
    const value = fields[field].value;
    return (
      aiValue !== undefined && !rules.isEmpty(value) && rules.isSame(value, aiValue)
    );
  };

  return {
    status: visibleStatus,
    canAnalyze,
    analyzeNow: () => {
      if (target) void analyze(target);
    },
    isAiValue,
    /** AIが入れた値のままで、確認を促したい項目か */
    needsCheck: (field: AutofillField) =>
      needsCheckFields.includes(field) && isAiValue(field),
  };
}
