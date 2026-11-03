"use client";

import { Button } from "@/components/ui/button";
import { Camera } from "lucide-react";
import { useRef } from "react";

// Flat Snap：服を平置きで撮るとき、ファイル選択メニューを挟まず標準カメラを直接開く入口。
// capture="environment" で背面カメラが開き、ピント合わせや権限の確認は端末の標準カメラに任せられる。
// スマホ以外では capture が効かず普通のファイル選択になるため、タッチ端末（pointer: coarse）でだけ表示する。

export function FlatSnapButton({
  onChange,
  disabled,
}: {
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  disabled: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="hidden [@media(pointer:coarse)]:block">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        disabled={disabled}
        onChange={(e) => {
          onChange(e);
          // 親の handler は files を同期で配列にしてから自分の input だけを空にする。
          // この input は親から見えないので、親の処理のあとにここで空にして、同じ写真をもう一度撮れるようにする。
          e.target.value = "";
        }}
      />
      <Button
        type="button"
        variant="outline"
        className="min-h-11 w-full"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
      >
        <Camera className="h-4 w-4" aria-hidden="true" />
        <span className="flex flex-wrap items-baseline justify-center gap-x-2">
          <span>Flat Snap</span>
          <span className="text-xs font-normal text-muted-foreground">
            服を1着ずつ撮る
          </span>
        </span>
      </Button>
    </div>
  );
}
