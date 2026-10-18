import { ClothingImageGallery } from "@/components/clothing-image-gallery";
import { DoodleLoop, DoodleUser } from "@/components/doodle-icons";
import { LikeButton, LoginToLikeLink } from "@/components/like-button";
import { ItemDetailSkeleton } from "@/components/loading-skeletons";
import { MarketplaceLinks } from "@/components/marketplace-links";
import { Badge } from "@/components/ui/badge";
import { formatSeasons, getCategoryLabel } from "@/lib/clothing-options";
import { getMyLoopItemStates } from "@/lib/loop-likes";
import { getMarketplaceLinks } from "@/lib/marketplace-urls";
import { buildLoginHrefForDiscoverItem } from "@/lib/safe-redirect";
import { getCurrentClaims } from "@/lib/supabase/current-user";
import { createClient } from "@/lib/supabase/server";
import { getPublicSignedImageUrls } from "@/lib/supabase/signed-image-urls";
import { formatJstDate } from "@/lib/wear-logs";
import type { Metadata } from "next";
import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache, Suspense } from "react";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// get_public_clothing_item（migration 008）の戻り値。
// 公開してよい列だけを返すRPCで、user_id・購入情報・着用情報・statusは含まない。
type PublicClothingItemDetailRow = {
  id: string;
  title: string;
  brand: string | null;
  category: string;
  /** migration 012 で追加。旧 season は互換用に返るが使わない */
  seasons: string[] | null;
  published_at: string;
  owner_display_name: string | null;
  image_paths: string[];
  mercari_url: string | null;
  rakuma_url: string | null;
  yahoo_furima_url: string | null;
};

// 公開データはRPCからのみ取得する。非公開の服・存在しない服はどちらも
// 0行（null）になる（「存在するが非公開」を外部へ漏らさない）。
// generateMetadataと本文の両方から呼ぶため、React.cacheで1リクエスト1回にまとめる。
const getPublicClothingItem = cache(async (id: string) => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .rpc("get_public_clothing_item", { p_item_id: id })
    .maybeSingle();

  if (error) {
    throw error;
  }

  return (data as PublicClothingItemDetailRow | null) ?? null;
});

// タイトル・公開名だけを使う（OGP画像には期限付きの署名URLを使わない）。
// 取得に失敗しても本文側のエラー表示に任せ、ここでは固定の値に戻す。
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const fallback: Metadata = { title: "Re:Closet Loop" };

  if (!UUID_PATTERN.test(id)) {
    return fallback;
  }

  try {
    const item = await getPublicClothingItem(id);
    if (!item) {
      return fallback;
    }
    const ownerName = item.owner_display_name ?? "Re:Closetユーザー";
    return {
      title: `${item.title} | Re:Closet Loop`,
      description: `${ownerName}さんがRe:Closet Loopで、次の人へつなごうとしている服です。`,
    };
  } catch {
    return fallback;
  }
}

async function PublicClothingItemDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  if (!UUID_PATTERN.test(id)) {
    notFound();
  }

  const item = await getPublicClothingItem(id);

  if (!item) {
    notFound();
  }

  const supabase = await createClient();
  const paths = item.image_paths ?? [];
  const signedUrlMap = await getPublicSignedImageUrls(
    paths,
    "public clothing image",
  );

  const imageUrls = paths
    .map((path) => signedUrlMap.get(path))
    .filter((url): url is string => Boolean(url));

  // RPCが意図的に公開している出品URL。DB制約に加え、表示直前にも検証する
  const marketplaceLinks = getMarketplaceLinks({
    mercari: item.mercari_url,
    rakuma: item.rakuma_url,
    yahooFurima: item.yahoo_furima_url,
  });

  // 「気になる」: ログイン中だけ状態を取得する（自分の服ならボタンを出さない）
  const user = await getCurrentClaims();
  const itemState = user
    ? (await getMyLoopItemStates(supabase, [item.id])).get(item.id)
    : undefined;

  return (
    <div className="flex flex-col gap-6">
      {/* ハートはメイン画像の右上に重ねる（自分の服には出さない） */}
      <div className="relative">
        <ClothingImageGallery images={imageUrls} alt={item.title} />
        {!user ? (
          <div className="absolute right-3 top-3 z-10">
            <LoginToLikeLink href={buildLoginHrefForDiscoverItem(item.id)} />
          </div>
        ) : itemState && !itemState.isOwner ? (
          <div className="absolute right-3 top-3 z-10">
            <LikeButton
              itemId={item.id}
              initialLiked={itemState.isLiked}
              showSavedNotice
            />
          </div>
        ) : null}
      </div>

      {/* ♡を表示しているときだけ（未ログイン・他人の服）、保存の意味と、取引できないことを伝える */}
      {(!user || (itemState && !itemState.isOwner)) && (
        <p className="text-xs leading-relaxed text-muted-foreground">
          ♡で気になる服に保存できます{!user && "（ログインが必要です）"}。保存は持ち主に通知されません。Re:Closet内での売買やメッセージはできません。
        </p>
      )}

      {/* 名前・ブランドを誌面風に。カテゴリ・季節は小さなバッジで添える */}
      <div className="flex flex-col gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          {item.brand && (
            <p className="truncate text-xs font-medium tracking-[0.15em] text-muted-foreground">
              {item.brand}
            </p>
          )}
          <h1 className="break-words text-2xl font-semibold leading-snug">{item.title}</h1>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Badge variant="secondary">{getCategoryLabel(item.category)}</Badge>
          {formatSeasons(item.seasons) && (
            <Badge variant="secondary">{formatSeasons(item.seasons)}</Badge>
          )}
        </div>
        {itemState?.isOwner && (
          <p className="text-xs text-muted-foreground">
            あなたが公開している服です
          </p>
        )}
      </div>

      {/* 公開した人・公開日（人のアイコンと並べて1つにまとめる） */}
      <div className="flex items-center gap-3 rounded-2xl bg-secondary/60 px-4 py-3 text-sm">
        <span
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-card text-primary"
          aria-hidden="true"
        >
          <DoodleUser size={22} />
        </span>
        <dl className="flex min-w-0 flex-1 flex-col">
          <dt className="sr-only">公開した人</dt>
          <dd className="min-w-0 break-words font-medium">
            {item.owner_display_name ?? "Re:Closetユーザー"}
          </dd>
          <dt className="sr-only">公開日</dt>
          <dd className="text-xs text-muted-foreground">
            {formatJstDate(item.published_at)}に公開
          </dd>
        </dl>
      </div>

      {marketplaceLinks.length > 0 && (
        <section
          aria-labelledby="loop-marketplace-title"
          className="flex flex-col gap-3 rounded-3xl bg-gradient-to-br from-primary/10 to-blush/20 p-5"
        >
          <h2
            id="loop-marketplace-title"
            className="flex items-center gap-2 text-base font-semibold"
          >
            <DoodleLoop size={20} className="text-primary" />
            この服が気になったら
          </h2>
          <MarketplaceLinks links={marketplaceLinks} />
          <p className="text-xs text-muted-foreground">
            外部サイトに移動します。出品状況は各サービスでご確認ください。
          </p>
        </section>
      )}
    </div>
  );
}

// 戻り先: 未ログインはLoopトップ（/）、ログイン中はLoop一覧（/discover）。
// どちらも同じ公開服一覧を表示している。
async function BackToLoopLink() {
  const user = await getCurrentClaims();
  return (
    <Link href={user ? "/discover" : "/"} className="-ml-1 flex min-h-10 w-fit items-center gap-1 rounded-lg pr-2 text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
      <ChevronLeft className="h-4 w-4" aria-hidden="true" />
      Re:Closet Loop
    </Link>
  );
}

export default function PublicClothingItemPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <div className="w-full max-w-md mx-auto flex flex-col gap-6">
      <Suspense
        fallback={
          <span className="flex min-h-10 items-center gap-1 text-sm text-muted-foreground">
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            Re:Closet Loop
          </span>
        }
      >
        <BackToLoopLink />
      </Suspense>

      <Suspense fallback={<ItemDetailSkeleton />}>
        <PublicClothingItemDetail params={params} />
      </Suspense>
    </div>
  );
}
