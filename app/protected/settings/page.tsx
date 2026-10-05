import { DisplayNameForm } from "@/components/display-name-form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getSafeReturnTo } from "@/lib/display-name";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { Suspense } from "react";

async function DisplayNameSettings({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { returnTo: rawReturnTo } = await searchParams;
  // 戻り先は自分の服の詳細ページ（/protected/items/{uuid}）だけを許可する
  const returnTo = getSafeReturnTo(rawReturnTo);

  const supabase = await createClient();
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user) {
    return (
      <p className="text-sm text-muted-foreground">
        ログイン情報が確認できませんでした
      </p>
    );
  }

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", user.id)
    .maybeSingle();

  if (error) {
    throw error;
  }

  const displayName: string | null = profile?.display_name ?? null;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm">
        現在の公開名：
        {displayName ? (
          <span className="font-medium">{displayName}</span>
        ) : (
          <span className="text-muted-foreground">未設定</span>
        )}
      </p>
      <DisplayNameForm initialDisplayName={displayName} returnTo={returnTo} />
      {returnTo && (
        <Link
          href={returnTo}
          className="text-sm underline underline-offset-4 text-muted-foreground w-fit"
        >
          ← 服の詳細に戻る
        </Link>
      )}
    </div>
  );
}

export default function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  return (
    <div className="w-full max-w-md mx-auto flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold">設定</h1>
        <p className="text-sm text-muted-foreground">
          アカウントや公開情報を設定できます。
        </p>
      </div>

      {/* 設定項目は今後セクション（Card）単位で追加する */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">公開名</CardTitle>
          <CardDescription>
            服を一般公開したときに表示される名前です。
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <ul className="list-disc pl-5 text-sm text-muted-foreground">
            <li>メールアドレスは公開されません</li>
            <li>1〜20文字で設定できます</li>
            <li>あとから何度でも変更できます</li>
            <li>他のユーザーと同じ名前でも大丈夫です</li>
          </ul>
          <Suspense
            fallback={
              <p className="text-sm text-muted-foreground">読み込み中...</p>
            }
          >
            <DisplayNameSettings searchParams={searchParams} />
          </Suspense>
        </CardContent>
      </Card>
    </div>
  );
}
