import { isUsableDisplayName } from "@/lib/display-name";
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

// ログイン中ユーザーの公開名（profiles.display_name）。未ログイン・未設定・
// 取得失敗時はnull。ヘッダーとトップの挨拶で使うため、getCurrentClaimsと
// 同じくReact.cacheで1リクエスト1回にまとめる。
export const getCurrentDisplayName = cache(async (): Promise<string | null> => {
  const claims = await getCurrentClaims();
  if (!claims?.sub) return null;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", claims.sub)
    .maybeSingle();

  if (error) {
    console.error("getCurrentDisplayName error:", error);
    return null;
  }

  const displayName: string | null = data?.display_name ?? null;
  return isUsableDisplayName(displayName) ? displayName : null;
});
