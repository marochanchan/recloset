import { tryCreateMediaStore } from "@/lib/outfits/media-deps";
import { createClient } from "@/lib/supabase/server";
import { ChevronLeft } from "lucide-react";
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
    ? await supabase.from("clothing_items").select("id, title, brand").in("id", itemIds)
    : { data: [], error: null };
  if (itemsError) {
    throw itemsError;
  }

  // 写真は ready のものだけ。Cloudflare の設定が足りなければ、写真なしで表示を続ける
  const { data: media, error: mediaError } = await supabase
    .from("outfit_media")
    .select("provider_asset_id")
    .eq("outfit_id", id)
    .eq("kind", "photo")
    .eq("status", "ready")
    .order("sort_order")
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
          className="max-h-[32rem] w-full rounded-2xl bg-photo object-contain"
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
            {items.map((item) => (
              <li key={item.id}>
                <Link
                  href={`/protected/items/${item.id}`}
                  className="flex min-h-12 flex-col justify-center rounded-2xl border border-border/70 bg-card px-4 py-2 outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {item.brand && (
                    <span className="text-xs text-muted-foreground">{item.brand}</span>
                  )}
                  <span className="text-sm font-medium">{item.title}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">服はまだ選ばれていません</p>
        )}
      </section>
    </div>
  );
}

export default function LookDetailPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <div className="w-full max-w-md mx-auto flex flex-col gap-6">
      <Link
        href="/protected/items"
        className="-ml-1 flex min-h-10 w-fit items-center gap-1 rounded-lg pr-2 text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        クローゼット
      </Link>
      <Suspense fallback={<p className="text-sm text-muted-foreground">読み込んでいます</p>}>
        <LookDetail params={params} />
      </Suspense>
    </div>
  );
}
