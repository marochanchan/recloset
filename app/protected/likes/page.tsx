import { ItemGridSkeleton } from "@/components/loading-skeletons";
import { PublicClothingItemCard } from "@/components/public-clothing-item-card";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

export const metadata: Metadata = {
  title: "気になる服 | Re:Closet",
};

const SIGNED_URL_EXPIRES_IN = 600; // 10分

// list_my_liked_public_clothing_items（migration 011）の戻り値。
// 本人の「気になる」のうち、現在公開中の服だけが返る（非公開になった服は含まれない）。
type LikedPublicClothingItemRow = {
  id: string;
  title: string;
  brand: string | null;
  category: string;
  season: string | null;
  published_at: string;
  owner_display_name: string | null;
  cover_image_path: string | null;
  liked_at: string;
};

async function LikedClothingItemsList() {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(
    "list_my_liked_public_clothing_items",
  );

  if (error) {
    throw error;
  }

  const items = (data ?? []) as LikedPublicClothingItemRow[];

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed px-4 py-10 text-center">
        <p className="font-medium">まだ気になる服はありません</p>
        <p className="text-sm text-muted-foreground">
          Re:Closet Loopで♡を押した服が、ここに並びます。
        </p>
        <Button asChild variant="outline" size="sm">
          <Link href="/discover">Re:Closet Loopを見る</Link>
        </Button>
      </div>
    );
  }

  const coverPaths = items
    .map((item) => item.cover_image_path)
    .filter((path): path is string => Boolean(path));

  const signedUrlMap = new Map<string, string>();

  if (coverPaths.length > 0) {
    // 公開服の画像だけを許可するStorageポリシー（migration 008）により発行できる
    const { data: signedUrls, error: signError } = await supabase.storage
      .from("clothing-images")
      .createSignedUrls(coverPaths, SIGNED_URL_EXPIRES_IN);

    if (signError) {
      console.error("liked clothing image signed url error:", signError);
    } else {
      for (const entry of signedUrls) {
        if (entry.error || !entry.path || !entry.signedUrl) {
          console.error("liked clothing image signed url entry error:", entry);
          continue;
        }
        signedUrlMap.set(entry.path, entry.signedUrl);
      }
    }
  }

  return (
    <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
      {items.map((item) => {
        const imageUrl = item.cover_image_path
          ? (signedUrlMap.get(item.cover_image_path) ?? null)
          : null;

        return (
          <Link
            key={item.id}
            href={`/discover/${item.id}`}
            className="block h-full"
          >
            <PublicClothingItemCard
              title={item.title}
              brand={item.brand}
              category={item.category}
              season={item.season}
              ownerDisplayName={item.owner_display_name ?? "Re:Closetユーザー"}
              imageUrl={imageUrl}
            />
          </Link>
        );
      })}
    </div>
  );
}

export default function LikedClothingItemsPage() {
  return (
    <div className="w-full flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold">気になる服</h1>
        <p className="text-sm text-muted-foreground">
          Re:Closet Loopで「気になる」に保存した服です。保存したことは、あなた以外には表示されません。
        </p>
      </div>

      <Suspense fallback={<ItemGridSkeleton variant="discover" />}>
        <LikedClothingItemsList />
      </Suspense>
    </div>
  );
}
