import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getCategoryLabel, getSeasonLabel } from "@/lib/clothing-options";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function ClothingItemDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  if (!UUID_PATTERN.test(id)) {
    notFound();
  }

  const supabase = await createClient();
  const { data: item, error } = await supabase
    .from("clothing_items")
    .select(
      "id, title, brand, category, season, purchase_date, purchase_price, favorite, status, wear_count, last_worn_at",
    )
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!item) {
    notFound();
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-2xl">{item.title}</CardTitle>
          {item.favorite && <Badge>お気に入り</Badge>}
        </div>
        {item.brand && (
          <p className="text-sm text-muted-foreground">{item.brand}</p>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary">{getCategoryLabel(item.category)}</Badge>
          {item.season && (
            <Badge variant="secondary">{getSeasonLabel(item.season)}</Badge>
          )}
          <Badge variant="outline">{item.status}</Badge>
        </div>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <dt className="text-muted-foreground">購入日</dt>
          <dd>{item.purchase_date ?? "未登録"}</dd>

          <dt className="text-muted-foreground">購入価格</dt>
          <dd>
            {item.purchase_price !== null ? `¥${item.purchase_price}` : "未登録"}
          </dd>

          <dt className="text-muted-foreground">着用回数</dt>
          <dd>{item.wear_count}回</dd>

          <dt className="text-muted-foreground">最終着用日</dt>
          <dd>{item.last_worn_at ?? "未記録"}</dd>
        </dl>
      </CardContent>
    </Card>
  );
}

export default function ClothingItemDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <div className="w-full max-w-md mx-auto flex flex-col gap-6">
      <Link
        href="/protected/items"
        className="text-sm underline underline-offset-4 text-muted-foreground w-fit"
      >
        ← 一覧に戻る
      </Link>

      <Suspense
        fallback={
          <p className="text-sm text-muted-foreground">読み込み中...</p>
        }
      >
        <ClothingItemDetail params={params} />
      </Suspense>
    </div>
  );
}
