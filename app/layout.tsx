import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
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

const geistSans = Geist({
  variable: "--font-geist-sans",
  display: "swap",
  subsets: ["latin"],
});

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja" suppressHydrationWarning>
      <body className={`${geistSans.className} antialiased`}>
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
