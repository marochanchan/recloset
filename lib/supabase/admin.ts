import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// service_role の管理用クライアント。サーバーのファイルからだけ import すること（ブラウザに出さない）。
// 本番の service_role は既存のテーブルに権限がないので、RPC と、このプランで権限を付けた新しいテーブルだけに使う。
export function createAdminClient(): SupabaseClient {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
