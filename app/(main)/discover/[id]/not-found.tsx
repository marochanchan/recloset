import { Button } from "@/components/ui/button";
import Link from "next/link";

// 非公開の服・存在しない服・不正なidはすべてここに来る
// （どれに当たるかは外部に区別させない）。
export default function PublicClothingItemNotFound() {
  return (
    <div className="w-full max-w-md mx-auto flex flex-col items-center gap-4 py-10 text-center">
      <h1 className="text-xl font-bold">この服は見つかりませんでした</h1>
      <p className="text-sm text-muted-foreground">
        非公開になったか、削除された可能性があります。
      </p>
      <Button asChild variant="outline">
        <Link href="/discover">Re:Closet Loopに戻る</Link>
      </Button>
    </div>
  );
}
