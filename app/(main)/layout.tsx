import { BottomNav } from "@/components/bottom-nav";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { Suspense } from "react";

// トップ・Loop・Closet・Today・My Pageの共通レイアウト（URLには影響しない）。
// /auth/* はこのグループの外にあり、ヘッダー・BottomNavを表示しない。
export default function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex flex-col items-center">
      <SiteHeader />
      <main className="flex-1 w-full flex flex-col items-center">
        {children}
      </main>
      <SiteFooter />
      <Suspense fallback={null}>
        <BottomNav />
      </Suspense>
    </div>
  );
}
