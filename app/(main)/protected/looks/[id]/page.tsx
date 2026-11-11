import { createOutfitMediaDeps, tryCreateMediaStore } from "@/lib/outfits/media-deps";
import { refreshPendingMedia } from "@/lib/outfits/media-service";
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

  // 写真は ready のものだけ、動画は届いたもの（変換中・失敗も含む）。Cloudflare の設定が足りなければ、メディアなしで表示を続ける
  const { data: media, error: mediaError } = await supabase
    .from("outfit_media")
    .select("id, kind, status, provider_asset_id, width, height")
    .eq("outfit_id", id)
    .in("kind", ["photo", "video"])
    .order("sort_order")
    .order("created_at");
  if (mediaError) {
    console.error("look detail: fetch media error", mediaError.code);
  }

  const store = tryCreateMediaStore();
  const now = new Date();
  const photos = (media ?? []).filter((m) => m.kind === "photo" && m.status === "ready");
  // uploading のままのもの（送信が終わらなかった動画）は出さない
  let video = (media ?? []).find((m) => m.kind === "video" && m.status !== "uploading");

  // webhook や完了の知らせが届かなかった動画を、Stream の実際の状態に合わせる。
  // この着画の最初の未完了の動画1本だけ、表示1回につき1回。失敗しても画面は止めない
  const pendingVideo = (media ?? []).find(
    (m) => m.kind === "video" && (m.status === "processing" || m.status === "uploading"),
  );
  if (pendingVideo && typeof userId === "string") {
    try {
      const { deps } = createOutfitMediaDeps();
      const refreshed = await refreshPendingMedia(deps, { userId, mediaId: pendingVideo.id });
      if (refreshed && refreshed.status !== "uploading") {
        video = {
          ...pendingVideo,
          status: refreshed.status,
          width: refreshed.width,
          height: refreshed.height,
        };
      }
    } catch {
      console.error("look detail: refresh video state failed");
    }
  }
  const photoUrls = store
    ? photos.map((m) => ({
        url: store.signedImageUrl(m.provider_asset_id, "display", now),
        width: m.width,
        height: m.height,
      }))
    : [];
  const videoIframeUrl =
    store && video?.status === "ready" ? store.signedStreamUrls(video.provider_asset_id, now).iframeUrl : null;

  return (
    <div className="flex flex-col gap-6">
      {photoUrls.length > 0 ? (
        // 写真を横に並べる。タップすると大きい画像が開く
        <ul className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1" aria-label="着画の写真">
          {photoUrls.map((photo, index) => (
            <li key={photo.url} className={photoUrls.length > 1 ? "w-[85%] shrink-0 snap-center" : "w-full"}>
              <a href={photo.url} target="_blank" rel="noreferrer" aria-label={`写真 ${index + 1} を大きく見る`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={photo.url}
                  alt={`着画 ${index + 1}`}
                  width={photo.width ?? undefined}
                  height={photo.height ?? undefined}
                  className="h-auto max-h-[32rem] w-full rounded-2xl bg-photo object-contain"
                />
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-2xl bg-secondary/60 px-4 py-6 text-center text-sm text-muted-foreground">
          {(media ?? []).some((m) => m.kind === "photo")
            ? "写真は今は表示できません。しばらくしてから開き直してください"
            : "写真はまだありません"}
        </p>
      )}

      {video && (
        <section aria-labelledby="look-video-title" className="flex flex-col gap-2">
          <h2 id="look-video-title" className="text-base font-semibold">
            動画
          </h2>
          {videoIframeUrl ? (
            <div
              className="w-full overflow-hidden rounded-2xl bg-photo"
              style={{ aspectRatio: video.width && video.height ? `${video.width} / ${video.height}` : "16 / 9" }}
            >
              <iframe
                src={videoIframeUrl}
                title="着画の動画"
                allow="accelerometer; gyroscope; autoplay; encrypted-media; picture-in-picture; fullscreen"
                allowFullScreen
                className="h-full w-full border-0"
              />
            </div>
          ) : (
            <p className="rounded-2xl bg-secondary/60 px-4 py-6 text-center text-sm text-muted-foreground">
              {video.status === "failed" || !store ? "動画を再生できませんでした" : "動画を準備しています"}
            </p>
          )}
        </section>
      )}

      <div className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold">{outfit.worn_on}</h1>
        {outfit.status === "pending" && (
          <p className="text-xs text-muted-foreground">未確定</p>
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
                    href={`/protected/items/${item.id}?from=${id}`}
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
