"use client";

import { Button } from "@/components/ui/button";
import type {
  AutofillField,
  AutofillStatus,
} from "@/components/use-image-autofill";
import { Loader2, Sparkles } from "lucide-react";

const FIELD_LABELS: Record<AutofillField, string> = {
  title: "タイトル",
  category: "カテゴリー",
  subcategory: "種類",
  mainColor: "メインカラー",
  seasons: "季節",
};

// 写真からの自動入力の状況（画像欄の下に小さく表示する）
export function ImageAutofillStatus({
  status,
  canAnalyze,
  onAnalyze,
}: {
  status: AutofillStatus;
  canAnalyze: boolean;
  onAnalyze: () => void;
}) {
  let message: string | null = null;
  let tone: "muted" | "error" = "muted";

  switch (status.kind) {
    case "analyzing":
      message = "写真から読み取っています…";
      break;
    case "filled":
      message = `写真から${status.fields
        .map((field) => FIELD_LABELS[field])
        .join("・")}を入力しました。必要に応じて修正してください`;
      break;
    case "nothing_to_fill":
      message = "写真を読み取りました（入力済みの項目はそのままにしています）";
      break;
    case "not_clothing":
      message = "写真に服が見つかりませんでした。そのまま入力して登録できます";
      break;
    case "error":
      message = status.message;
      tone = "error";
      break;
  }

  if (!message && !canAnalyze) return null;

  return (
    <div
      aria-live="polite"
      className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl bg-primary/10 px-3.5 py-2.5 text-sm"
    >
      {message && (
        <p
          className={
            tone === "error"
              ? "flex items-center gap-2 text-destructive"
              : "flex items-center gap-2 text-muted-foreground"
          }
        >
          {status.kind === "analyzing" ? (
            <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden="true" />
          ) : (
            <Sparkles className="h-4 w-4 shrink-0" aria-hidden="true" />
          )}
          {message}
        </p>
      )}
      {canAnalyze && (
        <Button type="button" variant="outline" size="sm" onClick={onAnalyze}>
          {status.kind === "error"
            ? "もう一度読み取る"
            : "この写真から読み取る"}
        </Button>
      )}
    </div>
  );
}
