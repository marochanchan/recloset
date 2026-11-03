import { tryCreateMediaStore } from "@/lib/outfits/media-deps";
import { DeleteLookButton } from "@/components/delete-look-button";
import { DoodleHanger } from "@/components/doodle-icons";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";
import { getPrivateSignedImageUrls } from "@/lib/supabase/signed-image-urls";
import { ChevronLeft } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function LookDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_PATTERN.test(id)) {
    notFound();
  }

  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  const { data: outfit, error } = await supabase
    .from("outfits")
    .select("id, worn_on, status, note")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    throw error;
  }
  if (!outfit) {
    notFound();
  }

  const { data: links, error: linksError } = await supabase
    .from("outfit_items")
    .select("item_id")
    .eq("outfit_id", id);
  if (linksError) {
    throw linksError;
  }
  const itemIds = (links ?? []).map((l) => l.item_id);
  const { data: items, error: itemsError } = itemIds.length
    ? await supabase.from("clothing_items").select("id, title, brand, clothing_images(image_path, sort_order)")
        .in("id", itemIds)
        .order("sort_order", { referencedTable: "clothing_images" })
    : { data: [], error: null };
  if (itemsError) {
    throw itemsError;
  }

  // 服の写真（いちばん前の1枚）。取れない服は文字だけで出す
  const urlByPath = await getPrivateSignedImageUrls(
    supabase,
    userId,
    (items ?? [])
      .map((item) => item.clothing_images[0]?.image_path)
      .filter((p): p is string => Boolean(p)),
    "look detail items",
  );

  // 写真は ready のものだけ。Cloudflare の設定が足りなければ、写真なしで表示を続ける
  const { data: media, error: mediaError } = await supabase
    .from("outfit_media")
    .select("provider_asset_id, width, height")
    .eq("outfit_id", id)
    .eq("kind", "photo")
    .eq("status", "ready")
    .order("sort_order")
    .order("created_at")
    .limit(1);
  if (mediaError) {
    console.error("look detail: fetch media error", mediaError.code);
  }

  const store = tryCreateMediaStore();
  const photoAssetId = media?.[0]?.provider_asset_id;
  const photoUrl =
    store && photoAssetId ? store.signedImageUrl(photoAssetId, "display", new Date()) : null;

  return (
    <div className="flex flex-col gap-6">
      {photoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={photoUrl}
          alt="着画"
          width={media?.[0]?.width ?? undefined}
          height={media?.[0]?.height ?? undefined}
          className="h-auto max-h-[32rem] w-full rounded-2xl bg-photo object-contain"
        />
      ) : (
        <p className="rounded-2xl bg-secondary/60 px-4 py-6 text-center text-sm text-muted-foreground">
          {photoAssetId
            ? "写真は今は表示できません。しばらくしてから開き直してください"
            : "写真はまだありません"}
        </p>
      )}

      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">{outfit.worn_on}</h1>
        {outfit.status === "pending" && (
          <p className="text-xs text-muted-foreground">まだ確定していません</p>
        )}
        {outfit.note && <p className="text-sm text-muted-foreground">{outfit.note}</p>}
      </div>

      <section aria-labelledby="look-items-title" className="flex flex-col gap-3">
        <h2 id="look-items-title" className="text-base font-semibold">
          着た服
        </h2>
        {items && items.length > 0 ? (
          <ul className="flex flex-col gap-2">
            {items.map((item) => {
              const path = item.clothing_images[0]?.image_path;
              const url = path ? urlByPath.get(path) : undefined;
              return (
                <li key={item.id}>
                  <Link
                    href={`/protected/items/${item.id}`}
                    className="flex min-h-16 items-center gap-3 rounded-2xl border border-border/70 bg-card p-2 outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="relative block h-14 w-14 shrink-0 overflow-hidden rounded-xl bg-photo">
                      {url ? (
                        <Image
                          src={url}
                          alt=""
                          fill
                          sizes="56px"
                          className="object-contain"
                          style={{ objectFit: "contain" }}
                        />
                      ) : (
                        <span className="flex h-full w-full items-center justify-center text-primary/50">
                          <DoodleHanger size={24} />
                        </span>
                      )}
                    </span>
                    <span className="flex min-w-0 flex-col justify-center">
                      {item.brand && (
                        <span className="text-xs text-muted-foreground">{item.brand}</span>
                      )}
                      <span className="text-sm font-medium">{item.title}</span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">服はまだ選ばれていません</p>
        )}
        {outfit.status === "confirmed" && (
          <Button asChild variant="outline" className="w-fit">
            <Link href={`/protected/looks/${id}/edit`}>着た服を直す</Link>
          </Button>
        )}
      </section>

      <div className="mt-4 border-t border-border/60 pt-4">
        <DeleteLookButton outfitId={id} />
      </div>
    </div>
  );
}

export default function LookDetailPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <div className="w-full max-w-md mx-auto flex flex-col gap-6">
      <Link
        href="/protected/looks"
        className="-ml-1 flex min-h-10 w-fit items-center gap-1 rounded-lg pr-2 text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        着画
      </Link>
      <Suspense fallback={<p className="text-sm text-muted-foreground">読み込んでいます</p>}>
        <LookDetail params={params} />
      </Suspense>
    </div>
  );
}
