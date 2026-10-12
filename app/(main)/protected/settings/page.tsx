import { DisplayNameForm } from "@/components/display-name-form";
import { WeeklyReviewGoalForm } from "@/components/weekly-review-goal-form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getSafeReturnTo } from "@/lib/display-name";
import { WEEKLY_REVIEW_GOAL_LOAD_ERROR_MESSAGE } from "@/lib/habit-progress-copy";
import { fetchWeeklyReviewGoal } from "@/lib/habit-settings";
import { getCurrentClaims } from "@/lib/supabase/current-user";
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

// 週次の見直し目標（RLSにより本人の設定だけが返る。未保存なら週3着）。
// 読み込めなかった場合も選び直して保存できるよう、選択なしでフォームを出す
async function WeeklyReviewGoalSettings() {
  const result = await fetchWeeklyReviewGoal(await createClient());
  return (
    <div className="flex flex-col gap-3">
      {!result.ok && (
        <p className="text-sm text-muted-foreground">
          {WEEKLY_REVIEW_GOAL_LOAD_ERROR_MESSAGE}。選び直して保存できます。
        </p>
      )}
      <WeeklyReviewGoalForm initialGoal={result.ok ? result.goal : undefined} />
    </div>
  );
}

// ログイン中のアカウント（メールアドレス）の確認用。編集機能は持たない。
// ヘッダーと同じgetCurrentClaims（リクエスト内でキャッシュ）を使う。
async function AccountEmail() {
  const claims = await getCurrentClaims();
  const email = typeof claims?.email === "string" ? claims.email : null;

  return (
    <p className="text-sm text-muted-foreground">
      ログイン中のアカウント：
      <span className="break-all">{email ?? "確認できませんでした"}</span>
    </p>
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
          アカウントや公開情報、見直しの目標を設定できます。
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

      <Card id="weekly-review-goal" className="scroll-mt-20">
        <CardHeader>
          <CardTitle className="text-lg">週次の見直し目標</CardTitle>
          <CardDescription>
            1週間（月曜〜日曜）に見直す服の目安です。Todayの「今週のRe:Closet」に反映されます。
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <ul className="list-disc pl-5 text-sm text-muted-foreground">
            <li>AI診断とスワイプでの見直しを合わせて数えます（同じ服は週1着）</li>
            <li>着用記録は目標に含めません</li>
            <li>いつでも変更でき、今週の進捗も新しい目標で計算し直します</li>
          </ul>
          <Suspense
            fallback={
              <p className="text-sm text-muted-foreground">読み込み中...</p>
            }
          >
            <WeeklyReviewGoalSettings />
          </Suspense>
        </CardContent>
      </Card>

      <Suspense fallback={null}>
        <AccountEmail />
      </Suspense>
    </div>
  );
}
