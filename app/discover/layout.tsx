import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";

// 一般公開ページ用のレイアウト。未ログインでも閲覧できる（proxyで除外済み）。
// 見た目はprotected/layout.tsxに揃えている。
export default function DiscoverLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main className="min-h-screen flex flex-col items-center">
      <div className="flex-1 w-full flex flex-col gap-8 items-center">
        <SiteHeader />
        <div className="flex-1 w-full flex flex-col gap-20 max-w-5xl p-5">
          {children}
        </div>

        <SiteFooter />
      </div>
    </main>
  );
}
