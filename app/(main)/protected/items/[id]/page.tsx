import { ClothingImageGallery } from "@/components/clothing-image-gallery";
import { Badge } from "@/components/ui/badge";
import { StatusSelector } from "@/components/status-selector";
import { Button } from "@/components/ui/button";
import { DeleteItemButton } from "@/components/delete-item-button";
import { ItemDetailSkeleton } from "@/components/loading-skeletons";
import { MarketplaceLinks } from "@/components/marketplace-links";
import { PublishToggle } from "@/components/publish-toggle";
import { WearTodayButton } from "@/components/wear-today-button";
import {
  getCategoryLabel,
  formatSeasons,
  getColorLabel,
  getSubcategoryLabel,
  getStatusLabel,
} from "@/lib/clothing-options";
import { getMarketplaceLinks } from "@/lib/marketplace-urls";
import { createClient } from "@/lib/supabase/server";
import { getPrivateSignedImageUrls } from "@/lib/supabase/signed-image-urls";
import { formatJstDate, hasWornToday } from "@/lib/wear-logs";
import { Heart, Pencil, Sparkles } from "lucide-react";
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
      "id, title, brand, category, subcategory, main_color, seasons, purchase_date, purchase_price, favorite, status, wear_count, last_worn_at, is_public, published_at, mercari_url, rakuma_url, yahoo_furima_url, clothing_images(image_path, sort_order)",
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

  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;

  // RLSで取得した本人の服の画像だけを署名する
  const signedUrlMap = await getPrivateSignedImageUrls(
    supabase,
    userId,
    item.clothing_images.map((img) => img.image_path),
    "clothing item detail",
  );

  const imageUrls = item.clothing_images
    .map((img) => signedUrlMap.get(img.image_path))
    .filter((url): url is string => Boolean(url));

  const alreadyLoggedToday = await hasWornToday(supabase, item.id);

  const marketplaceLinks = getMarketplaceLinks({
    mercari: item.mercari_url,
    rakuma: item.rakuma_url,
    yahooFurima: item.yahoo_furima_url,
  });

  // 公開UIで「公開名が設定済みか」を判定するため、本人の公開名を取得する。
  // 公開可否の最終判定はServer Action（setClothingItemPublication）側で行う。
  let displayName: string | null = null;
  if (userId) {
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("display_name")
      .eq("id", userId)
      .maybeSingle();
    if (profileError) {
      console.error("clothing item detail: fetch profile error", profileError);
    } else {
      displayName = profile?.display_name ?? null;
    }
  }

  const tags = [
    getCategoryLabel(item.category),
    item.subcategory ? getSubcategoryLabel(item.subcategory) : null,
    item.main_color ? getColorLabel(item.main_color) : null,
    formatSeasons(item.seasons) || null,
  ].filter((tag): tag is string => Boolean(tag));

  // 写真 → 名前 → 「今日着た」を最初に置き、そのあとを意味ごとのまとまり
  // （どうする？／記録／AI診断／公開・出品）に分ける。削除は最後に控えめに置く
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-5">
        <ClothingImageGallery images={imageUrls} alt={item.title} />

        <div className="flex flex-col gap-3">
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 flex-col gap-1">
              {item.brand && (
                <p className="truncate text-xs font-medium tracking-[0.15em] text-muted-foreground">
                  {item.brand}
                </p>
              )}
              <h1 className="break-words text-2xl font-bold leading-snug">
                {item.title}
              </h1>
            </div>
            <Button asChild variant="outline" size="sm" className="h-9 shrink-0 rounded-full px-3">
              <Link href={`/protected/items/${item.id}/edit`}>
                <Pencil aria-hidden="true" />
                編集する
              </Link>
            </Button>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {item.favorite && (
              <Badge className="gap-1 border-transparent bg-blush/20 text-blush-foreground hover:bg-blush/20">
                <Heart className="h-3 w-3 fill-current" aria-hidden="true" />
                お気に入り
              </Badge>
            )}
            {tags.map((tag) => (
              <Badge key={tag} variant="secondary">
                {tag}
              </Badge>
            ))}
            <Badge variant="outline">{getStatusLabel(item.status)}</Badge>
          </div>
        </div>

        <WearTodayButton
          itemId={item.id}
          alreadyLoggedToday={alreadyLoggedToday}
        />
      </div>

      <section className="flex flex-col gap-3">
        <StatusSelector itemId={item.id} currentStatus={item.status} />
      </section>

      <section aria-labelledby="item-records-title" className="flex flex-col gap-3">
        <h2 id="item-records-title" className="text-base font-bold">
          記録
        </h2>
        <dl className="flex flex-col divide-y divide-border rounded-2xl border border-border/70 bg-card px-4 text-sm">
          <div className="flex items-baseline justify-between gap-4 py-3">
            <dt className="shrink-0 text-muted-foreground">Re:Closetでの着用記録</dt>
            <dd className="text-right">
              <span className="text-lg font-bold tabular-nums">{item.wear_count}</span>回
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-4 py-3">
            <dt className="shrink-0 text-muted-foreground">最後に着た日</dt>
            <dd className="text-right">
              {item.last_worn_at
                ? formatJstDate(item.last_worn_at)
                : "まだRe:Closetでの着用記録がありません"}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-4 py-3">
            <dt className="shrink-0 text-muted-foreground">購入日</dt>
            <dd className="text-right">{item.purchase_date ?? "未登録"}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-4 py-3">
            <dt className="shrink-0 text-muted-foreground">購入価格</dt>
            <dd className="text-right">
              {item.purchase_price !== null
                ? `¥${item.purchase_price}`
                : "未登録"}
            </dd>
          </div>
        </dl>
      </section>

      {/* AI診断は「一緒に考える」入口として、淡い色の面で目立たせる */}
      <section
        aria-labelledby="item-diagnosis-title"
        className="flex flex-col gap-3 rounded-3xl bg-gradient-to-br from-primary/10 to-blush/20 p-5"
      >
        <div className="flex flex-col gap-1">
          <h2 id="item-diagnosis-title" className="flex items-center gap-2 text-base font-bold">
            <Sparkles className="h-4 w-4 text-primary" aria-hidden="true" />
            AIと一緒に見直す
          </h2>
          <p className="text-sm text-muted-foreground">
            着用データと今の気持ちから、次の一歩を一緒に考えます
          </p>
        </div>
        <Button asChild variant="outline" className="w-full">
          <Link href={`/protected/items/${item.id}/diagnosis`}>
            AI診断
          </Link>
        </Button>
      </section>

      <section aria-labelledby="item-share-title" className="flex flex-col gap-3">
        <h2 id="item-share-title" className="text-base font-bold">
          公開・出品
        </h2>
        <div className="flex flex-col gap-4 rounded-2xl border border-border/70 bg-card p-4">
          <PublishToggle
            itemId={item.id}
            isPublic={item.is_public}
            displayName={displayName}
            publishedAtLabel={
              item.published_at ? formatJstDate(item.published_at) : null
            }
          />
          {marketplaceLinks.length > 0 && (
            <div className="flex flex-col gap-2 border-t pt-4">
              <p className="text-sm font-medium">出品先</p>
              <MarketplaceLinks links={marketplaceLinks} />
              {!item.is_public && (
                <p className="text-xs text-muted-foreground">
                  Loopで公開すると、出品先も公開ページに表示されます。
                </p>
              )}
            </div>
          )}
        </div>
      </section>

      <div className="flex flex-col gap-2 border-t pt-6">
        <DeleteItemButton itemId={item.id} />
      </div>
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
        ← クローゼットに戻る
      </Link>

      <Suspense fallback={<ItemDetailSkeleton />}>
        <ClothingItemDetail params={params} />
      </Suspense>
    </div>
  );
}
