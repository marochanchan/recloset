"use client";

import { analyzeClothingImageForAutofill } from "@/app/(main)/protected/items/new/actions";
import { processImageForAnalysis, type ImageRotation } from "@/lib/image-processing";
import { useCallback, useEffect, useRef, useState } from "react";

// ============================================================
// 登録フォームの「写真からタイトル・カテゴリーを自動入力」。
//
// - 代表画像（並び順の先頭）1枚だけを解析する
// - 解析対象は「画像のkey＋回転」で識別し、今の対象と違う結果は反映しない
//   （解析中に画像を差し替えた・回転した場合に古い結果を入れないため）
// - 自動で解析するのは画像ごとに1回だけ。回転後・失敗後はボタンで再実行する
// - 解析に成功した対象はもう一度送らない（同じ画像で無駄なリクエストをしない）
// - 入力するのは「空欄」か「前回AIが入れた値のまま」の項目だけ。
//   ユーザーが入力・修正した値は上書きしない
// ============================================================

/** 代表画像（新しく選び、縮小処理が終わったもの） */
export type AutofillTarget = {
  key: string;
  rotation: ImageRotation;
  sourceFile: File;
};

type AutofillField = "title" | "category";

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
  title,
  category,
  setTitle,
  setCategory,
}: {
  /** 新規登録のときだけtrue */
  enabled: boolean;
  target: AutofillTarget | null;
  title: string;
  category: string;
  setTitle: (value: string) => void;
  setCategory: (value: string) => void;
}) {
  const [status, setStatus] = useState<AutofillStatus>({ kind: "idle" });
  // AIが最後に入れた値（ユーザーが変えていなければ、次の結果で更新してよい）
  const [aiValues, setAiValues] = useState<
    Partial<Record<AutofillField, string>>
  >({});

  // 非同期の結果を受け取った時点の最新値を参照するためのref
  const latest = useRef({ title, category, aiValues, targetId: "" });
  latest.current = {
    title,
    category,
    aiValues,
    targetId: target ? getTargetId(target) : "",
  };

  const completedTargetIds = useRef<Set<string>>(new Set());
  const autoAnalyzedKeys = useRef<Set<string>>(new Set());
  const [analyzingTargetId, setAnalyzingTargetId] = useState<string | null>(
    null,
  );

  const analyze = useCallback(
    async (analysisTarget: AutofillTarget) => {
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

        const current = latest.current;
        const canFill = (field: AutofillField, value: string) =>
          value.trim() === "" || value === current.aiValues[field];

        const filled: AutofillField[] = [];
        const nextAiValues = { ...current.aiValues };
        if (result.title && canFill("title", current.title)) {
          setTitle(result.title);
          nextAiValues.title = result.title;
          filled.push("title");
        }
        if (result.category && canFill("category", current.category)) {
          setCategory(result.category);
          nextAiValues.category = result.category;
          filled.push("category");
        }
        setAiValues(nextAiValues);
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
    },
    [setTitle, setCategory],
  );

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

  return {
    status: visibleStatus,
    canAnalyze,
    analyzeNow: () => {
      if (target) void analyze(target);
    },
    isAiValue: (field: AutofillField, value: string) =>
      value !== "" && aiValues[field] === value,
  };
}
