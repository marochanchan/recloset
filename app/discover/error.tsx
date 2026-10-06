"use client";

import { Button } from "@/components/ui/button";
import { useEffect } from "react";

// /discover 配下の取得エラー用。retry()はサーバー側のデータを取り直して再描画する
// （Next.js 16.3以降。reset()は再取得しないため、RPCの一時的な失敗には効かない）。
export default function DiscoverError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error("discover page error:", error);
  }, [error]);

  return (
    <div className="w-full max-w-md mx-auto flex flex-col items-center gap-4 py-10 text-center">
      <h1 className="text-xl font-bold">服の読み込みに失敗しました</h1>
      <p className="text-sm text-muted-foreground">
        時間をおいて、もう一度お試しください。
      </p>
      <Button type="button" variant="outline" onClick={() => retry()}>
        もう一度試す
      </Button>
    </div>
  );
}
