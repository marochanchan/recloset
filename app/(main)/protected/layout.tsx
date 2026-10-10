// ログイン必須ページ用のレイアウト（未ログインはproxyで/auth/loginへ）。
// ヘッダー・フッターは app/(main)/layout.tsx で共通化している。
export default function ProtectedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex-1 w-full flex flex-col gap-20 max-w-5xl p-5">
      {children}
    </div>
  );
}
