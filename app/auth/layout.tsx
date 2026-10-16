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
    // 背景は、セージと淡いピンクがほんのり重なるやわらかなグラデーション
    <div className="relative bg-gradient-to-b from-primary/10 via-background to-blush/20">
      <header className="absolute inset-x-0 top-0 flex h-14 items-center justify-center text-sm">
        <HeaderLogo href="/" />
      </header>
      {children}
    </div>
  );
}
