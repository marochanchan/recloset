"use client";

import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";

export function LogoutButton() {
  const logout = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    // 未ログインの表玄関（/ = Re:Closet Loop）へ。ヘッダー・BottomNavは
    // (main)レイアウトに属し、クライアント遷移では再取得されずログイン中の
    // 表示が残るため、ページ全体を読み込み直す。
    window.location.assign("/");
  };

  return <Button onClick={logout}>ログアウト</Button>;
}
