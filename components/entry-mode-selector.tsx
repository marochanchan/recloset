"use client";

import { cn } from "@/lib/utils";

// 新規登録の入力方法の切り替え（通常登録・写真だけ登録）。
// 通常登録のフォーム（clothing-item-form.tsx）と、写真からまとめて登録する画面
// （photo-batch-register-form.tsx）の両方で使う
export function EntryModeSelector({
  isPhotoOnly,
  onChange,
  disabled,
}: {
  isPhotoOnly: boolean;
  onChange: (isPhotoOnly: boolean) => void;
  disabled: boolean;
}) {
  const options = [
    { photoOnly: false, label: "通常登録", description: "名前や種類も入力（AIが補助）" },
    { photoOnly: true, label: "写真だけで登録", description: "1着でも、まとめて何着でも。" },
  ];
  return (
    <div
      role="radiogroup"
      aria-label="登録のしかた"
      className="mb-5 grid grid-cols-2 gap-2"
    >
      {options.map((option) => {
        const selected = option.photoOnly === isPhotoOnly;
        return (
          <button
            key={option.label}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => onChange(option.photoOnly)}
            className={cn(
              "flex flex-col items-start gap-0.5 rounded-xl border px-3.5 py-2.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
              selected
                ? "border-primary bg-primary/10"
                : "border-border bg-card text-muted-foreground hover:bg-accent",
            )}
          >
            <span className="text-sm font-medium text-foreground">
              {option.label}
            </span>
            <span className="text-xs text-muted-foreground">
              {option.description}
            </span>
          </button>
        );
      })}
    </div>
  );
}
