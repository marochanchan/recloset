import { HeaderLogo } from "@/components/site-header";

// 認証画面（ログイン・新規登録など）用。BottomNavは置かず、
// ロゴからRe:Closet Loopのトップ（/）へ戻れるようにだけする。
// 各ページはフォームを画面中央に置くため、ロゴは上部に重ねて配置する。
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="relative">
      <header className="absolute inset-x-0 top-0 flex h-14 items-center justify-center text-sm">
        <HeaderLogo href="/" />
      </header>
      {children}
    </div>
  );
}
