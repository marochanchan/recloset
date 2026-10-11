"use client";

import { Button } from "@/components/ui/button";
import { useEffect, useRef } from "react";

// 服登録フォームで、未保存の入力があるままアプリ内のリンクを押したときの確認。
// WelcomeDialog・ImageLightboxと同じくネイティブの<dialog>（showModal）を使うため、
// 背景の操作無効化・Escで閉じる・フォーカスの閉じ込めと復帰はブラウザが行う。
export function LeaveConfirmDialog({
  open,
  onCancel,
  onConfirm,
  description = "このまま移動すると、保存していない変更が失われます。続きから入力したい場合は、下書きとして保存してください。",
}: {
  open: boolean;
  /** 説明文（写真だけ登録では、下書きの案内を出さない） */
  description?: string;
  /** 「編集を続ける」・Esc・背景のクリック */
  onCancel: () => void;
  /** 「保存せず移動」 */
  onConfirm: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="leave-confirm-title"
      aria-describedby="leave-confirm-description"
      // Escで閉じたときも「編集を続ける」と同じ扱いにする
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
      // 背景（::backdrop）のクリックで閉じる
      onClick={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
      className="m-auto w-[calc(100%-2rem)] max-w-sm rounded-xl border bg-background p-0 text-foreground shadow-lg backdrop:bg-black/40"
    >
      <div className="flex flex-col gap-4 p-5">
        <div className="flex flex-col gap-2">
          <h2 id="leave-confirm-title" className="text-lg font-bold">
            入力途中の内容があります
          </h2>
          <p
            id="leave-confirm-description"
            className="text-sm leading-relaxed text-muted-foreground"
          >
            {description}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="destructive"
            className="flex-1"
            onClick={onConfirm}
          >
            保存せず移動
          </Button>
          <Button
            type="button"
            variant="outline"
            className="flex-1"
            onClick={onCancel}
            autoFocus
          >
            編集を続ける
          </Button>
        </div>
      </div>
    </dialog>
  );
}
