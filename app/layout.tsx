import type { Metadata, Viewport } from "next";
import { Geist, Zen_Kaku_Gothic_New, Zen_Maru_Gothic } from "next/font/google";
import { ThemeProvider } from "next-themes";
import "./globals.css";

// OG画像などの絶対URLの基準。本番はデプロイごとのURL（VERCEL_URL）ではなく
// 本番ドメインを使う（デプロイごとのURLはVercelの保護でSNSのクローラーが取得できない場合があるため）
const defaultUrl =
  process.env.VERCEL_ENV === "production" &&
  process.env.VERCEL_PROJECT_PRODUCTION_URL
    ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
    : process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(defaultUrl),
  title: "Re:Closet",
  description:
    "着ていない服に気づき、もう一度着る・残す・手放すを考えるクローゼットアシスタント",
};

// iPhoneのホームインジケーター領域（safe-area）を env(safe-area-inset-*) で
// 扱えるようにする（スマホのBottomNavで使用）
export const viewport: Viewport = {
  viewportFit: "cover",
};

// 英数字（Geist）。フォントの指定順は tailwind.config.ts の fontFamily を参照
const geistSans = Geist({
  variable: "--font-geist-sans",
  display: "swap",
  subsets: ["latin"],
});

// 日本語の本文（ゴシック）。日本語の文字は使う範囲（unicode-range）だけが
// 読み込まれるため、プリロードはせず、太さも本文で使う3つに絞る
const zenKakuGothic = Zen_Kaku_Gothic_New({
  variable: "--font-zen-kaku",
  weight: ["400", "500", "700"],
  display: "swap",
  subsets: ["latin"],
  preload: false,
});

// ロゴの「Re:Closet」だけに使う丸ゴシック。英字だけなので、実際に読み込まれるのは
// 英字の範囲（unicode-range）の小さなファイルだけ。太さも1つに絞る
const zenMaruGothic = Zen_Maru_Gothic({
  variable: "--font-zen-maru",
  weight: "700",
  display: "swap",
  subsets: ["latin"],
  preload: false,
});

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ja"
      suppressHydrationWarning
      className={`${geistSans.variable} ${zenKakuGothic.variable} ${zenMaruGothic.variable}`}
    >
      <body className="antialiased">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
