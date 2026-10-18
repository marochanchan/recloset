import type { Metadata, Viewport } from "next";
import { Inter, Noto_Sans_JP } from "next/font/google";
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

// 英数字（Inter）。フォントの指定順は tailwind.config.ts の fontFamily を参照
const inter = Inter({
  variable: "--font-inter",
  display: "swap",
  subsets: ["latin"],
});

// 日本語（Noto Sans JP）。可変フォントのため太さ（本文400・見出し500〜600）は1つのファイルで扱える。
// 日本語の文字は使う範囲（unicode-range）だけが読み込まれるため、プリロードはしない
const notoSansJp = Noto_Sans_JP({
  variable: "--font-noto-sans-jp",
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
      className={`${inter.variable} ${notoSansJp.variable}`}
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
