import { BottomMainNav } from "@/components/main-nav";
import { getCurrentClaims } from "@/lib/supabase/current-user";
import { hasEnvVars } from "@/lib/utils";

// スマホ用の下部固定ナビ。ログイン中だけ表示する（未ログインには出さない）。
// 固定ナビの裏にページ末尾（フッター・フォームの保存ボタン等）が隠れないよう、
// 同じ高さのスペーサーを通常のフローに置く。
export async function BottomNav() {
  if (!hasEnvVars) return null;

  const user = await getCurrentClaims();
  if (!user) return null;

  return (
    <>
      <div
        aria-hidden="true"
        className="h-[calc(4rem+env(safe-area-inset-bottom))] w-full shrink-0 md:hidden"
      />
      <BottomMainNav />
    </>
  );
}
