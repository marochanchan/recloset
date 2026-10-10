"use client";

import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef } from "react";

// 未ログインのLoopトップ（/）で一度だけ出す、Re:Closetの初回案内。
// ネイティブの<dialog>（showModal）を使うため、背景の操作無効化・Escで閉じる・
// フォーカスの閉じ込めと復帰はブラウザが行う。
// 閉じた日時をlocalStorageに保存し、一定期間は再表示しない（DBは使わない）。

const DISMISSED_STORAGE_KEY = "recloset:welcome-dialog-dismissed-at";
const RESHOW_AFTER_MS = 30 * 24 * 60 * 60 * 1000; // 30日

const STEPS = [
  "1着登録",
  "着た日を記録",
  "AIと一緒に次を考える",
  "Loopやフリマへつなぐ",
] as const;

function wasRecentlyDismissed(): boolean {
  try {
    const value = window.localStorage.getItem(DISMISSED_STORAGE_KEY);
    if (!value) return false;
    const dismissedAt = Number(value);
    return (
      Number.isFinite(dismissedAt) && Date.now() - dismissedAt < RESHOW_AFTER_MS
    );
  } catch {
    // localStorageが使えない環境（プライベートモード等）では毎回出さない
    return true;
  }
}

function rememberDismissed() {
  try {
    window.localStorage.setItem(DISMISSED_STORAGE_KEY, String(Date.now()));
  } catch {
    // 保存できなくても閉じる操作自体は続ける
  }
}

export function WelcomeDialog() {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || dialog.open || wasRecentlyDismissed()) return;
    dialog.showModal();
  }, []);

  const close = () => {
    dialogRef.current?.close();
  };

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="welcome-dialog-title"
      aria-describedby="welcome-dialog-description"
      // ×・Esc・「はじめる」のどれで閉じても、再表示しないよう記録する
      onClose={rememberDismissed}
      // 背景（::backdrop）のクリックで閉じる
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
      className="m-auto w-[calc(100%-2rem)] max-w-sm rounded-xl border bg-background p-0 text-foreground shadow-lg backdrop:bg-black/40"
    >
      <div className="relative flex flex-col gap-4 p-5">
        <button
          type="button"
          onClick={close}
          aria-label="閉じる"
          className="absolute right-2 top-2 flex h-10 w-10 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <X className="h-5 w-5" aria-hidden="true" />
        </button>

        <div className="flex flex-col gap-2 pr-8">
          <h2 id="welcome-dialog-title" className="text-lg font-bold">
            Re:Closetをはじめてみる？
          </h2>
          <p
            id="welcome-dialog-description"
            className="text-sm leading-relaxed text-muted-foreground"
          >
            全部登録しなくていい。今日の1着から、
            着る・残す・手放すを考えるクローゼットへ。
          </p>
        </div>

        <ol className="grid grid-cols-2 gap-2 text-sm">
          {STEPS.map((step, index) => (
            <li
              key={step}
              className="flex items-center gap-2 rounded-lg bg-muted/60 px-3 py-2"
            >
              <span
                aria-hidden="true"
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground"
              >
                {index + 1}
              </span>
              <span className="leading-snug">{step}</span>
            </li>
          ))}
        </ol>

        <div className="flex flex-col gap-2">
          <Button asChild>
            <Link href="/auth/sign-up" onClick={close}>
              はじめる
            </Link>
          </Button>
          <Button type="button" variant="ghost" onClick={close}>
            まずはLoopを見る
          </Button>
        </div>
      </div>
    </dialog>
  );
}
