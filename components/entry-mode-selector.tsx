"use client";

import { DoodleHangerPlus } from "@/components/doodle-icons";
import { cn } from "@/lib/utils";
import { Camera } from "lucide-react";

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
    {
      photoOnly: false,
      label: "通常登録",
      description: "AIが入力を補助",
      icon: <DoodleHangerPlus size={22} />,
    },
    {
      photoOnly: true,
      label: "写真だけで登録",
      description: "まとめて何着でも",
      icon: <Camera className="h-5 w-5" aria-hidden="true" />,
    },
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
              "flex min-h-14 items-center gap-2.5 rounded-2xl border px-3 py-2.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
              selected
                ? "border-primary bg-primary/10"
                : "border-border bg-card text-muted-foreground hover:bg-accent",
            )}
          >
            <span
              className={cn(
                "flex h-9 w-9 shrink-0 items-center justify-center rounded-full",
                selected ? "bg-card text-primary" : "bg-secondary text-muted-foreground",
              )}
              aria-hidden="true"
            >
              {option.icon}
            </span>
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="text-sm font-medium leading-tight text-foreground">
                {option.label}
              </span>
              <span className="text-[11px] leading-tight text-muted-foreground">
                {option.description}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
