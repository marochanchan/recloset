import { LogoutButton } from "@/components/logout-button";
import { ThemeSwitcher } from "@/components/theme-switcher";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  getCurrentClaims,
  getCurrentDisplayName,
} from "@/lib/supabase/current-user";
import { createClient } from "@/lib/supabase/server";
import { formatJstDate } from "@/lib/wear-logs";
import { ChevronRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

export const metadata: Metadata = {
  title: "My Page | Re:Closet",
};

const PUBLIC_ITEMS_PREVIEW_LIMIT = 5;

function MenuLink({
  href,
  label,
  description,
}: {
  href: string;
  label: string;
  description?: string;
}) {
  return (
    <Link
      href={href}
      className="flex items-center justify-between gap-3 rounded-md px-1 py-2 hover:bg-accent"
    >
      <span className="flex flex-col">
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

  return (
    <div className="flex flex-col gap-1">
      <p className="text-lg font-semibold">
        {displayName ?? (
          <span className="text-muted-foreground">公開名は未設定です</span>
        )}
      </p>
      {email && (
        <p className="break-all text-xs text-muted-foreground">{email}</p>
      )}
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
      <p className="text-sm text-muted-foreground">
        公開中の服はありません。服の詳細ページから、Re:Closet Loopに公開できます。
      </p>
    );
  }

  return (
    <ul className="flex flex-col">
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
    <div className="w-full max-w-md flex flex-col gap-6 p-5">
      <h1 className="text-2xl font-bold">My Page</h1>

      <Card>
        <CardContent className="pt-6">
          <Suspense
            fallback={
              <p className="text-sm text-muted-foreground">読み込み中...</p>
            }
          >
            <ProfileSummary />
          </Suspense>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">メニュー</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col">
          <MenuLink
            href="/protected/settings"
            label="アカウント設定"
            description="公開名の変更・ログイン中のアカウント"
          />
          <MenuLink
            href="/protected/likes"
            label="気になる服"
            description="Re:Closet Loopで保存した服"
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">公開中の服</CardTitle>
          <CardDescription>
            Re:Closet Loopで公開している服です（新しい順に最大
            {PUBLIC_ITEMS_PREVIEW_LIMIT}件）。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Suspense
            fallback={
              <p className="text-sm text-muted-foreground">読み込み中...</p>
            }
          >
            <MyPublicItems />
          </Suspense>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex items-center justify-between gap-3 pt-6">
          <span className="text-sm font-medium">テーマ</span>
          <ThemeSwitcher />
        </CardContent>
      </Card>

      <LogoutButton />
    </div>
  );
}
