import { createClient } from "@/lib/supabase/server";
import { cache } from "react";

// ログイン中ユーザーのclaimsを取得する（未ログインならnull）。
// ヘッダーと公開ページのCTAなど、同じリクエスト内の複数のServer Componentから
// 呼ばれるため、React.cacheで1リクエスト1回にまとめる。
export const getCurrentClaims = cache(async () => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  return data?.claims ?? null;
});
