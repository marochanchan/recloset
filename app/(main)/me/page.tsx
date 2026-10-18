import { LogoutButton } from "@/components/logout-button";
import { ThemeSwitcher } from "@/components/theme-switcher";
import {
  getCurrentClaims,
  getCurrentDisplayName,
} from "@/lib/supabase/current-user";
import { createClient } from "@/lib/supabase/server";
import { formatJstDate } from "@/lib/wear-logs";
import {
  BookOpen,
  ChevronRight,
  Heart,
  Palette,
  Settings,
  type LucideIcon,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

export const metadata: Metadata = {
  title: "My Page | Re:Closet",
};

const PUBLIC_ITEMS_PREVIEW_LIMIT = 5;

// 枠を増やさないよう、メニュー・公開中の服は1つの面の中に区切り線で並べる
const LIST_PANEL_CLASS =
  "flex flex-col divide-y divide-border overflow-hidden rounded-2xl border border-border/70 bg-card";

function MenuLink({
  href,
  label,
  description,
  icon: Icon,
}: {
  href: string;
  label: string;
  description?: string;
  icon?: LucideIcon;
}) {
  return (
    <Link
      href={href}
      className="flex min-h-14 items-center gap-3 px-4 py-3 outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring active:bg-accent"
    >
      {Icon && (
        <Icon className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
      )}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-sm font-medium">{label}</span>
        {description && (
          <span className="text-xs text-muted-foreground">{description}</span>
        )}
      </span>
      <ChevronRight
        className="h-4 w-4 shrink-0 text-muted-foreground"
        aria-hidden="true"
      />
    </Link>
  );
}

// 公開名とログイン中のアカウント（ヘッダーと同じReact.cacheの取得を使う）
async function ProfileSummary() {
  const [displayName, claims] = await Promise.all([
    getCurrentDisplayName(),
    getCurrentClaims(),
  ]);
  const email = typeof claims?.email === "string" ? claims.email : null;

  // 公開名の頭文字を丸いアイコンにする（未設定ならロゴの「R」）
  const initial = displayName ? Array.from(displayName)[0] : "R";

  return (
    <div className="flex items-center gap-4">
      <span
        className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-card text-xl font-semibold text-primary"
        aria-hidden="true"
      >
        {initial}
      </span>
      <div className="flex min-w-0 flex-col gap-0.5">
        <p className="break-words text-lg font-semibold">
          {displayName ?? (
            <span className="text-muted-foreground">公開名は未設定です</span>
          )}
        </p>
        {email && (
          <p className="break-all text-xs text-muted-foreground">{email}</p>
        )}
      </div>
    </div>
  );
}

// 自分が公開中の服（RLSにより本人の服だけが対象。user_idでも絞る）
async function MyPublicItems() {
  const claims = await getCurrentClaims();
  if (!claims?.sub) return null;

  const supabase = await createClient();
  const { data: items, error } = await supabase
    .from("clothing_items")
    .select("id, title, published_at")
    .eq("user_id", claims.sub)
    .eq("is_public", true)
    .order("published_at", { ascending: false })
    .limit(PUBLIC_ITEMS_PREVIEW_LIMIT);

  if (error) {
    console.error("my page public items error:", error);
    return (
      <p className="text-sm text-muted-foreground">
        公開中の服を読み込めませんでした
      </p>
    );
  }

  if (items.length === 0) {
    return (
      <p className="rounded-2xl bg-secondary/60 px-4 py-3 text-sm text-muted-foreground">
        公開中の服はありません。服の詳細ページから、Re:Closet Loopに公開できます。
      </p>
    );
  }

  return (
    <ul className={LIST_PANEL_CLASS}>
      {items.map((item) => (
        <li key={item.id}>
          <MenuLink
            href={`/protected/items/${item.id}`}
            label={item.title}
            description={
              item.published_at
                ? `${formatJstDate(item.published_at)}に公開`
                : undefined
            }
          />
        </li>
      ))}
    </ul>
  );
}

export default function MyPage() {
  return (
    <div className="w-full max-w-md flex flex-col gap-8 p-5">
      <h1 className="text-2xl font-semibold">My Page</h1>

      <div className="rounded-3xl bg-gradient-to-br from-primary/10 to-blush/20 px-5 py-5">
        <Suspense
          fallback={
            <p className="text-sm text-muted-foreground">読み込み中...</p>
          }
        >
          <ProfileSummary />
        </Suspense>
      </div>

      <section aria-labelledby="me-menu-title" className="flex flex-col gap-3">
        <h2 id="me-menu-title" className="text-base font-semibold">
          メニュー
        </h2>
        <div className={LIST_PANEL_CLASS}>
          <MenuLink
            href="/protected/settings"
            label="アカウント設定"
            description="公開名の変更・ログイン中のアカウント"
            icon={Settings}
          />
          <MenuLink
            href="/protected/likes"
            label="気になる服"
            description="Re:Closet Loopで保存した服"
            icon={Heart}
          />
          <MenuLink
            href="/protected/story"
            label="Re:Story これまでの記録"
            description="服との日々を、月ごとに振り返る"
            icon={BookOpen}
          />
          <div className="flex min-h-14 items-center gap-3 px-4 py-2">
            <Palette className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
            <span className="flex-1 text-sm font-medium">テーマ</span>
            <ThemeSwitcher />
          </div>
        </div>
      </section>

      <section aria-labelledby="me-public-title" className="flex flex-col gap-3">
        <div className="flex flex-col gap-0.5">
          <h2 id="me-public-title" className="text-base font-semibold">
            公開中の服
          </h2>
          <p className="text-xs text-muted-foreground">
            Re:Closet Loopで公開している服です（新しい順に最大
            {PUBLIC_ITEMS_PREVIEW_LIMIT}件）。
          </p>
        </div>
        <Suspense
          fallback={
            <p className="text-sm text-muted-foreground">読み込み中...</p>
          }
        >
          <MyPublicItems />
        </Suspense>
      </section>

      <div className="border-t pt-6">
        <LogoutButton />
      </div>
    </div>
  );
}
