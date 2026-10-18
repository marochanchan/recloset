import { cn } from "@/lib/utils";
import type { ReactNode, SVGProps } from "react";

// ============================================================
// Re:Closet の手描き風の線画アイコン（Todayの主要機能用）
// - 少し不揃いな曲線と丸い線端で、ペンで描いたような柔らかさを出す
// - 線の色は currentColor（text-primary 等に追従し、ライト/ダークの両方で使える）
// - 機能ごとに意味を固定する（登録＝ハンガー＋、見直し＝タグ、着用＝シャツ、
//   振り返り＝本、Loop＝循環、Re:Garden＝芽、提案＝きらめき）
// ============================================================

type DoodleIconProps = Omit<SVGProps<SVGSVGElement>, "children"> & {
  size?: number;
};

function DoodleIcon({
  size = 24,
  className,
  children,
  ...props
}: DoodleIconProps & { children: ReactNode }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={cn("shrink-0", className)}
      {...props}
    >
      {children}
    </svg>
  );
}

/** ハンガー（今日のRe:try・服） */
export function DoodleHanger(props: DoodleIconProps) {
  return (
    <DoodleIcon {...props}>
      <path d="M12 8.6V7.7c0-.6.4-1 .9-1.3a1.9 1.9 0 1 0-2.7-1.9" />
      <path d="M12 8.6c-2.8 2-5.6 3.9-8.3 6.1-.8.6-.4 1.8.6 1.8 5.2.1 10.4 0 15.5 0 1 0 1.4-1.2.6-1.8-2.8-2.1-5.5-4.1-8.4-6.1" />
    </DoodleIcon>
  );
}

/** ハンガー＋（服を登録する） */
export function DoodleHangerPlus(props: DoodleIconProps) {
  return (
    <DoodleIcon {...props}>
      <path d="M11 7.3V6.5c0-.6.4-1 .9-1.3a1.9 1.9 0 1 0-2.7-1.9" />
      <path d="M11 7.3c-2.6 1.8-5.1 3.6-7.6 5.6-.8.6-.4 1.7.6 1.7h10.2" />
      <path d="M11 7.3c2.5 1.7 4.9 3.4 7.3 5.3" />
      <path d="M18.4 15.2c0 1.8.1 3.6 0 5.4M15.6 17.9c1.9-.1 3.8 0 5.6 0" />
    </DoodleIcon>
  );
}

/** タグ（服を見直す・仕分ける） */
export function DoodleTag(props: DoodleIconProps) {
  return (
    <DoodleIcon {...props}>
      <path d="M3.9 12.5c2.5-2.6 5-5.1 7.6-7.6.4-.4.9-.6 1.4-.6l5.6.1c.9 0 1.6.7 1.6 1.6l.1 5.6c0 .5-.2 1-.6 1.4-2.5 2.6-5 5.1-7.6 7.6-.6.6-1.6.6-2.3 0l-5.8-5.8c-.6-.7-.6-1.7 0-2.3z" />
      <circle cx="16" cy="8" r="1.2" />
      <path d="M8.4 13.4c.6.6 1.2 1.1 1.8 1.7 1.1-1.2 2.2-2.4 3.4-3.6" />
    </DoodleIcon>
  );
}

/** シャツ（着た服を記録する） */
export function DoodleShirt(props: DoodleIconProps) {
  return (
    <DoodleIcon {...props}>
      <path d="M8.6 4.3c1 .9 2.1 1.3 3.4 1.3s2.5-.5 3.5-1.3c1.4.8 2.9 1.5 4.3 2.3.4.2.5.6.4 1l-1.2 3c-.2.4-.6.5-1 .4l-1.5-.6c0 3 .1 6.1.2 9.1 0 .4-.3.7-.7.7-2.6.1-5.3.1-7.9 0-.4 0-.7-.3-.7-.7.1-3 .2-6.1.3-9.1l-1.6.6c-.4.1-.8 0-1-.4l-1.1-3c-.1-.4 0-.8.4-1 1.4-.8 2.8-1.6 4.2-2.3z" />
      <path d="M10.2 5.3c.4 1 1 1.5 1.8 1.5s1.4-.5 1.8-1.5" />
    </DoodleIcon>
  );
}

/** ひらいた本（Re:Story・振り返り） */
export function DoodleBook(props: DoodleIconProps) {
  return (
    <DoodleIcon {...props}>
      <path d="M12 6.6c-1.9-1.4-4.6-2-7.7-1.8-.5 0-.8.4-.8.9v11.6c0 .5.4.9.9.9 3-.1 5.5.5 7.6 1.9 2.1-1.4 4.6-2 7.6-1.9.5 0 .9-.4.9-.9V5.7c0-.5-.3-.9-.8-.9-3.1-.2-5.8.4-7.7 1.8z" />
      <path d="M12 6.6c.1 4.3 0 8.6 0 12.9" />
      <path d="M6.4 9.2c1.1 0 2.2.2 3.1.6M6.4 12.2c1.1 0 2.2.2 3.1.6" />
    </DoodleIcon>
  );
}

/** 循環の矢印とハート（Loop・誰かのクローゼット） */
export function DoodleLoop(props: DoodleIconProps) {
  return (
    <DoodleIcon {...props}>
      <path d="M19.4 10.3a7.6 7.6 0 0 0-13.5-3" />
      <path d="M5.5 3.9c.1 1.2.2 2.4.4 3.5 1.2-.1 2.4-.3 3.5-.5" />
      <path d="M4.6 13.7a7.6 7.6 0 0 0 13.5 3" />
      <path d="M18.5 20.1c-.1-1.2-.2-2.4-.4-3.5-1.2.1-2.4.3-3.5.5" />
      <path d="M12 14.7c-1.8-1.1-2.7-2.1-2.7-3.1 0-.8.6-1.4 1.4-1.4.6 0 1 .3 1.3.7.3-.4.7-.7 1.3-.7.8 0 1.4.6 1.4 1.4 0 1-.9 2-2.7 3.1z" />
    </DoodleIcon>
  );
}

/** 芽（Re:Garden） */
export function DoodleSprout(props: DoodleIconProps) {
  return (
    <DoodleIcon {...props}>
      <path d="M12 20.3c0-3.2-.2-6.3-.2-9.3" />
      <path d="M11.8 12.1c-3.8.2-6.6-1.8-7-5.8 3.9-.3 6.6 1.8 7 5.8z" />
      <path d="M12 14.4c.2-3.6 2.6-6 6.8-6.1.1 3.9-2.6 6.2-6.8 6.1z" />
      <path d="M7.4 20.5c3-.5 6.1-.5 9.2 0" />
    </DoodleIcon>
  );
}

/** きらめき（今日の提案のメッセージ） */
export function DoodleSparkle(props: DoodleIconProps) {
  return (
    <DoodleIcon {...props}>
      <path d="M11 3.6c.5 4 2.3 5.9 6.3 6.4-4 .5-5.8 2.4-6.3 6.4-.5-4-2.4-5.9-6.4-6.4 4-.5 5.9-2.4 6.4-6.4z" />
      <path d="M18.4 15.4c.2 1.4.8 2 2.1 2.2-1.3.2-1.9.8-2.1 2.2-.2-1.4-.8-2-2.2-2.2 1.4-.2 2-.8 2.2-2.2z" />
    </DoodleIcon>
  );
}
