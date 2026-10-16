import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function Page() {
  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <div className="w-full max-w-sm">
        <div className="flex flex-col gap-6">
          <Card className="rounded-3xl border-border/60 px-1 py-2 shadow-sm">
            <CardHeader>
              <CardTitle className="text-2xl">
                ご登録ありがとうございます
              </CardTitle>
              <CardDescription>メールをご確認ください</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                ご登録が完了しました。ログイン前に、届いたメールからアカウントを確認してください。
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
