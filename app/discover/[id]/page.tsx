import { ClothingImageGallery } from "@/components/clothing-image-gallery";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getCategoryLabel, getSeasonLabel } from "@/lib/clothing-options";
import { createClient } from "@/lib/supabase/server";
import { formatJstDate } from "@/lib/wear-logs";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SIGNED_URL_EXPIRES_IN = 600; // 10分

// get_public_clothing_item（migration 008）の戻り値。
// 公開してよい列だけを返すRPCで、user_id・購入情報・着用情報・statusは含まない。
type PublicClothingItemDetailRow = {
  id: string;
  title: string;
  brand: string | null;
  category: string;
  season: string | null;
  published_at: string;
  owner_display_name: string | null;
  image_paths: string[];
};

async function PublicClothingItemDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  if (!UUID_PATTERN.test(id)) {
    notFound();
  }

  // 公開データはRPCからのみ取得する。非公開の服・存在しない服はどちらも
  // 0行になり、同じnotFound()になる（「存在するが非公開」を外部へ漏らさない）。
  const supabase = await createClient();
  const { data, error } = await supabase
    .rpc("get_public_clothing_item", { p_item_id: id })
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data) {
    notFound();
  }

  const item = data as PublicClothingItemDetailRow;
  const paths = item.image_paths ?? [];
  const signedUrlMap = new Map<string, string>();

  if (paths.length > 0) {
    const { data: signedUrls, error: signError } = await supabase.storage
      .from("clothing-images")
      .createSignedUrls(paths, SIGNED_URL_EXPIRES_IN);

    if (signError) {
      console.error("public clothing image signed url error:", signError);
    } else {
      for (const entry of signedUrls) {
        if (entry.error || !entry.path || !entry.signedUrl) {
          console.error("public clothing image signed url entry error:", entry);
          continue;
        }
        signedUrlMap.set(entry.path, entry.signedUrl);
      }
    }
  }

  const imageUrls = paths
    .map((path) => signedUrlMap.get(path))
    .filter((url): url is string => Boolean(url));

  return (
    <div className="flex flex-col gap-4">
      <ClothingImageGallery images={imageUrls} alt={item.title} />

      <Card>
        <CardHeader>
          <CardTitle className="text-2xl">{item.title}</CardTitle>
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
          </div>

          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted-foreground">公開した人</dt>
            <dd>{item.owner_display_name ?? "Re:closetユーザー"}</dd>

            <dt className="text-muted-foreground">公開日</dt>
            <dd>{formatJstDate(item.published_at)}</dd>
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}

export default function PublicClothingItemPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <div className="w-full max-w-md mx-auto flex flex-col gap-6">
      <Link
        href="/discover"
        className="text-sm underline underline-offset-4 text-muted-foreground w-fit"
      >
        ← みんなの服に戻る
      </Link>

      <Suspense
        fallback={
          <p className="text-sm text-muted-foreground">読み込み中...</p>
        }
      >
        <PublicClothingItemDetail params={params} />
      </Suspense>
    </div>
  );
}
