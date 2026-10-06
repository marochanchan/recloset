import Link from "next/link";
import { Button } from "./ui/button";
import {
  getCurrentClaims,
  getCurrentDisplayName,
} from "@/lib/supabase/current-user";
import { LogoutButton } from "./logout-button";

export async function AuthButton() {
  const user = await getCurrentClaims();

  if (user) {
    // メールアドレスは表示せず、公開名（未設定なら「マイページ」）を
    // 設定ページへのリンクとして表示する
    const displayName = await getCurrentDisplayName();
    return (
      <div className="flex items-center gap-3">
        <Link
          href="/protected/settings"
          className="max-w-[10rem] truncate text-muted-foreground hover:text-foreground"
        >
          {displayName ?? "マイページ"}
        </Link>
        <LogoutButton />
      </div>
    );
  }

  return (
    <div className="flex gap-2">
      <Button asChild size="sm" variant={"outline"}>
        <Link href="/auth/login">ログイン</Link>
      </Button>
      <Button asChild size="sm" variant={"default"}>
        <Link href="/auth/sign-up">新規登録</Link>
      </Button>
    </div>
  );
}
