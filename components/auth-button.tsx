import Link from "next/link";
import { Button } from "./ui/button";
import { getCurrentClaims } from "@/lib/supabase/current-user";
import { LogoutButton } from "./logout-button";

export async function AuthButton() {
  const user = await getCurrentClaims();

  return user ? (
    <div className="flex items-center gap-3">
      <span className="hidden text-muted-foreground sm:inline">
        {user.email}
      </span>
      <LogoutButton />
    </div>
  ) : (
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
