import { DoodleHanger } from "@/components/doodle-icons";
import { Button } from "@/components/ui/button";
import { firstPhotoByOutfit, sortLooks } from "@/lib/outfits/looks";
import { tryCreateMediaStore } from "@/lib/outfits/media-deps";
import { createClient } from "@/lib/supabase/server";
import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";

const LOOKS_LIMIT = 60;

async function LooksGrid() {
  const supabase = await createClient();
  // 新しい順に上限まで読む（並びは sortLooks でも同じ規則にそろえる）
  const { data: outfits, error } = await supabase
    .from("outfits")
    .select("id, worn_on, status, created_at")
    .order("worn_on", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(LOOKS_LIMIT);
  if (error) {
    throw error;
  }
  const looks = sortLooks(outfits ?? []);

  if (looks.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-2xl bg-secondary/60 px-6 py-12 text-center">
        <p className="text-sm text-muted-foreground">まだ着画がありません</p>
        <Button asChild>
          <Link href="/protected/looks/new">着画を記録</Link>
        </Button>
      </div>
    );
  }

  const { data: media, error: mediaError } = await supabase
    .from("outfit_media")
    .select("outfit_id, provider_asset_id, sort_order, created_at")
    .in("outfit_id", looks.map((l) => l.id))
    .eq("kind", "photo")
    .eq("status", "ready");
  if (mediaError) {
    console.error("looks list: fetch media error", mediaError.code);
  }
  const assetByOutfit = firstPhotoByOutfit(media ?? []);
  // Cloudflare の設定が足りなければ、写真なしで表示を続ける
  const store = tryCreateMediaStore();
  const now = new Date();

  return (
    <ul className="grid grid-cols-2 gap-3">
      {looks.map((look) => {
        const assetId = assetByOutfit.get(look.id);
        const url = store && assetId ? store.signedImageUrl(assetId, "thumb", now) : null;
        return (
          <li key={look.id}>
            <Link
              href={`/protected/looks/${look.id}`}
              className="flex flex-col gap-1.5 rounded-2xl outline-none transition-transform focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.98]"
            >
              <span className="relative block aspect-[3/4] w-full overflow-hidden rounded-2xl bg-photo">
                {url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={url}
                    alt={`${look.worn_on}の着画`}
                    loading="lazy"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <span className="flex h-full w-full items-center justify-center text-primary/50">
                    <DoodleHanger size={32} />
                  </span>
                )}
              </span>
              <span className="flex items-center gap-2 px-0.5 text-sm">
                {look.worn_on}
                {look.status === "pending" && (
                  <span className="text-xs text-muted-foreground">未確定</span>
                )}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export default function LooksPage() {
  return (
    <div className="w-full max-w-md mx-auto flex flex-col gap-6">
      <Link
        href="/protected/items"
        className="-ml-1 flex min-h-10 w-fit items-center gap-1 rounded-lg pr-2 text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        クローゼット
      </Link>
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">着画</h1>
        <Button asChild variant="outline" size="sm" className="h-9 rounded-full px-3">
          <Link href="/protected/looks/new">記録する</Link>
        </Button>
      </div>
      <Suspense fallback={<p className="text-sm text-muted-foreground">読み込んでいます</p>}>
        <LooksGrid />
      </Suspense>
    </div>
  );
}
