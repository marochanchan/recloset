import { cn } from "@/lib/utils";

type BrandMarkProps = {
  /** 表示サイズ（px）。width/heightを個別に指定しない場合に使う */
  size?: number;
  width?: number;
  height?: number;
  className?: string;
  /** 文字の「Re:Closet」と並べるなど装飾として使う場合はtrue（既定） */
  decorative?: boolean;
};

/**
 * Re:Closetのブランドマーク（R × ハンガー × 循環）。
 * Rの脚がハンガーの肩につながり、下辺の端が循環の矢印としてRへ戻る。
 * 線の色はcurrentColorなので、文字色（text-foreground等）に追従し
 * ライト/ダークの両方で使える。
 */
export function BrandMark({
  size = 24,
  width,
  height,
  className,
  decorative = true,
}: BrandMarkProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={width ?? size}
      height={height ?? size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("shrink-0", className)}
      {...(decorative
        ? { "aria-hidden": true }
        : { role: "img", "aria-label": "Re:Closet" })}
    >
      {/* R */}
      <path d="M7 13V5h4.5a3 3 0 0 1 0 6H7" />
      {/* Rの脚 → ハンガーの肩と下辺 */}
      <path d="M10.5 11l8.7 6.1c.9.6.5 1.9-.6 1.9H8" />
      {/* 循環の矢印 */}
      <path d="M8 19a3.5 3.5 0 0 1-3.17-4.98" />
      <path d="M5.58 16.09l-.75-2.07-2.07.75" />
    </svg>
  );
}
