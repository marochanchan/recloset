"use client";

import { cn } from "@/lib/utils";
import {
  DoodleHanger,
  DoodleLoop,
  DoodleSunCloud,
  DoodleUser,
} from "@/components/doodle-icons";
import type { ComponentType, SVGProps } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

// ログイン中の主要メニュー（PCヘッダーとスマホのBottomNavで共通）。
// matchは「そのタブを現在地として示すか」の判定。
type MainNavItem = {
  href: string;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement> & { size?: number }>;
  match: (pathname: string) => boolean;
};

function isPathOrChild(pathname: string, base: string) {
  return pathname === base || pathname.startsWith(`${base}/`);
}

const MAIN_NAV_ITEMS: MainNavItem[] = [
  {
    href: "/discover",
    label: "Loop",
    icon: DoodleLoop,
    // 気になる服はLoopのサブページとして扱う
    match: (pathname) =>
      isPathOrChild(pathname, "/discover") ||
      isPathOrChild(pathname, "/protected/likes"),
  },
  {
    href: "/protected/items",
    label: "Closet",
    icon: DoodleHanger,
    match: (pathname) => isPathOrChild(pathname, "/protected/items"),
  },
  {
    href: "/today",
    label: "Today",
    icon: DoodleSunCloud,
    match: (pathname) => isPathOrChild(pathname, "/today"),
  },
  {
    href: "/me",
    label: "My Page",
    icon: DoodleUser,
    // 設定・Re:StoryはMy Pageから開く画面のため、My Pageを現在地とする
    match: (pathname) =>
      isPathOrChild(pathname, "/me") ||
      isPathOrChild(pathname, "/protected/settings") ||
      isPathOrChild(pathname, "/protected/story"),
  },
];

/** PCヘッダー用の横並びメニュー */
export function HeaderMainNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="メインメニュー">
      <ul className="flex items-center gap-1">
        {MAIN_NAV_ITEMS.map((item) => {
          const isActive = item.match(pathname);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "rounded-full px-4 py-2 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                  isActive
                    ? "bg-primary/10 font-medium text-primary"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/** スマホ用の下部固定メニュー（md以上では表示しない） */
export function BottomMainNav() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="メインメニュー"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border/70 bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
    >
      <ul className="grid h-16 grid-cols-4">
        {MAIN_NAV_ITEMS.map((item) => {
          const isActive = item.match(pathname);
          const Icon = item.icon;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "group flex h-full flex-col items-center justify-center gap-0.5 text-[11px] tracking-wide outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                  isActive
                    ? "font-semibold text-primary"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {/* 選択中のタブは、アイコンの後ろにセージの淡いピルを敷いて示す */}
                <span
                  className={cn(
                    "flex h-7 w-12 items-center justify-center rounded-full transition-colors",
                    isActive ? "bg-primary/10" : "group-hover:bg-accent",
                  )}
                >
                  {/* 手描き風の線画アイコン（Todayの導線と同じ）。選択中は線を少し太くする */}
                  <Icon size={24} strokeWidth={isActive ? 2.1 : 1.7} />
                </span>
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
