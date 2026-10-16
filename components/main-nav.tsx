"use client";

import { cn } from "@/lib/utils";
import { CloudSun, Recycle, Shirt, User, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

// ログイン中の主要メニュー（PCヘッダーとスマホのBottomNavで共通）。
// matchは「そのタブを現在地として示すか」の判定。
type MainNavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  match: (pathname: string) => boolean;
};

function isPathOrChild(pathname: string, base: string) {
  return pathname === base || pathname.startsWith(`${base}/`);
}

const MAIN_NAV_ITEMS: MainNavItem[] = [
  {
    href: "/discover",
    label: "Loop",
    icon: Recycle,
    // 気になる服はLoopのサブページとして扱う
    match: (pathname) =>
      isPathOrChild(pathname, "/discover") ||
      isPathOrChild(pathname, "/protected/likes"),
  },
  {
    href: "/protected/items",
    label: "Closet",
    icon: Shirt,
    match: (pathname) => isPathOrChild(pathname, "/protected/items"),
  },
  {
    href: "/today",
    label: "Today",
    icon: CloudSun,
    match: (pathname) => isPathOrChild(pathname, "/today"),
  },
  {
    href: "/me",
    label: "My Page",
    icon: User,
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
                  <Icon
                    className="h-5 w-5"
                    strokeWidth={isActive ? 2.25 : 1.75}
                    aria-hidden="true"
                  />
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
