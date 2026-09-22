import { ClothingImageGallery } from "@/components/clothing-image-gallery";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { StatusSelector } from "@/components/status-selector";
import { WearTodayButton } from "@/components/wear-today-button";
import {
  getCategoryLabel,
  getSeasonLabel,
  getStatusLabel,
} from "@/lib/clothing-options";
import { createClient } from "@/lib/supabase/server";
import { formatJstDate, hasWornToday } from "@/lib/wear-logs";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SIGNED_URL_EXPIRES_IN = 600; // 10分

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
      "id, title, brand, category, season, purchase_date, purchase_price, favorite, status, wear_count, last_worn_at, clothing_images(image_path, sort_order)",
    )
    .eq("id", id)
    .order("sort_order", { referencedTable: "clothing_images" })
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!item) {
    notFound();
  }

  const paths = item.clothing_images.map((img) => img.image_path);
  const signedUrlMap = new Map<string, string>();

  if (paths.length > 0) {
    const { data: signedUrls, error: signError } = await supabase.storage
      .from("clothing-images")
      .createSignedUrls(paths, SIGNED_URL_EXPIRES_IN);

    if (signError) {
      console.error("clothing image signed url error:", signError);
    } else {
      for (const entry of signedUrls) {
        if (entry.error || !entry.path || !entry.signedUrl) {
          console.error("clothing image signed url entry error:", entry);
          continue;
        }
        signedUrlMap.set(entry.path, entry.signedUrl);
      }
    }
  }

  const imageUrls = item.clothing_images
    .map((img) => signedUrlMap.get(img.image_path))
    .filter((url): url is string => Boolean(url));

  const alreadyLoggedToday = await hasWornToday(supabase, item.id);

  return (
    <div className="flex flex-col gap-4">
      <ClothingImageGallery images={imageUrls} alt={item.title} />

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
            <Badge variant="secondary">
              {getCategoryLabel(item.category)}
            </Badge>
            {item.season && (
              <Badge variant="secondary">{getSeasonLabel(item.season)}</Badge>
            )}
            <Badge variant="outline">{getStatusLabel(item.status)}</Badge>
          </div>

          <WearTodayButton
            itemId={item.id}
            alreadyLoggedToday={alreadyLoggedToday}
          />

          <StatusSelector itemId={item.id} currentStatus={item.status} />

          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted-foreground">購入日</dt>
            <dd>{item.purchase_date ?? "未登録"}</dd>

            <dt className="text-muted-foreground">購入価格</dt>
            <dd>
              {item.purchase_price !== null
                ? `¥${item.purchase_price}`
                : "未登録"}
            </dd>

            <dt className="text-muted-foreground">着用回数</dt>
            <dd>{item.wear_count}回</dd>

            <dt className="text-muted-foreground">最後に着た日</dt>
            <dd>
              {item.last_worn_at
                ? formatJstDate(item.last_worn_at)
                : "まだ着用記録がありません"}
            </dd>
          </dl>
        </CardContent>
      </Card>
    </div>
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
