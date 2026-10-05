"use client";

import {
  publishClothingItem,
  unpublishClothingItem,
} from "@/app/protected/items/[id]/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useState, useTransition } from "react";

type PublishToggleProps = {
  itemId: string;
  isPublic: boolean;
  /** サーバー側でJST整形済みの公開日（非公開ならnull） */
  publishedAtLabel: string | null;
};

export function PublishToggle({
  itemId,
  isPublic,
  publishedAtLabel,
}: PublishToggleProps) {
  const [isConfirming, setIsConfirming] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handlePublish = () => {
    if (isPending) return;
    setError(null);
    startTransition(async () => {
      const result = await publishClothingItem(itemId);
      if (result.error) {
        setError(result.error);
        return;
      }
      setIsConfirming(false);
    });
  };

  const handleUnpublish = () => {
    if (isPending) return;
    setError(null);
    startTransition(async () => {
      const result = await unpublishClothingItem(itemId);
      if (result.error) {
        setError(result.error);
      }
    });
  };

  if (isPublic) {
    return (
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <Badge>公開中</Badge>
          {publishedAtLabel && (
            <p className="text-sm text-muted-foreground">
              {publishedAtLabel}から公開しています
            </p>
          )}
        </div>
        <p className="text-sm text-muted-foreground">
          ログインしていない人も含め、誰でもこの服を見られる状態です。
        </p>
        <Button
          type="button"
          variant="outline"
          className="w-full"
          disabled={isPending}
          onClick={handleUnpublish}
        >
          {isPending ? "更新中..." : "非公開に戻す"}
        </Button>
        {error && <p className="text-sm text-red-500">{error}</p>}
      </div>
    );
  }

  if (!isConfirming) {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-sm text-muted-foreground">
          この服は非公開です（あなただけが見られます）
        </p>
        <Button
          type="button"
          variant="outline"
          className="w-full"
          onClick={() => setIsConfirming(true)}
        >
          公開する
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-md border p-3 text-sm">
      <p className="font-medium">この服を一般公開しますか？</p>
      <div className="flex flex-col gap-1">
        <p>
          ログインしていない人も含め、誰でも次の情報を見られるようになります。
        </p>
        <ul className="list-disc pl-5">
          <li>タイトル・ブランド・カテゴリ・季節</li>
          <li>登録しているすべての画像</li>
          <li>あなたの表示名</li>
        </ul>
      </div>
      <p className="text-muted-foreground">
        購入日・購入価格・お気に入り・着用記録・ステータス・AI診断の結果は公開されません。
        公開中に追加した画像も公開されます。非公開にはいつでも戻せます。
      </p>
      <div className="flex gap-2">
        <Button
          type="button"
          className="flex-1"
          disabled={isPending}
          onClick={handlePublish}
        >
          {isPending ? "更新中..." : "公開する"}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="flex-1"
          disabled={isPending}
          onClick={() => setIsConfirming(false)}
        >
          キャンセル
        </Button>
      </div>
      {error && <p className="text-sm text-red-500">{error}</p>}
    </div>
  );
}
