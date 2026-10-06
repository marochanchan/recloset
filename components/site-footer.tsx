import { ThemeSwitcher } from "@/components/theme-switcher";

// 全ページ共通のフッター（テーマ切り替え）
export function SiteFooter() {
  return (
    <footer className="w-full flex items-center justify-center border-t mx-auto text-center text-xs py-8">
      <ThemeSwitcher />
    </footer>
  );
}
