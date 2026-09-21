import { ClothingItemCard } from "@/components/clothing-item-card";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { Suspense } from "react";

const SIGNED_URL_EXPIRES_IN = 600; // 10分

async function ClothingItemsList() {
  const supabase = await createClient();
  const { data: items, error } = await supabase
    .from("clothing_items")
    .select(
      "id, title, brand, category, season, favorite, status, clothing_images(image_path, sort_order)",
    )
    .order("created_at", { ascending: false })
    .order("sort_order", { referencedTable: "clothing_images" });

  if (error) {
    throw error;
  }

  if (items.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        まだ登録された服がありません。「服を登録」から追加してください。
      </p>
    );
  }

  const representativePaths = items
    .map((item) => item.clothing_images[0]?.image_path)
    .filter((path): path is string => Boolean(path));

  const signedUrlMap = new Map<string, string>();

  if (representativePaths.length > 0) {
    const { data: signedUrls, error: signError } = await supabase.storage
      .from("clothing-images")
      .createSignedUrls(representativePaths, SIGNED_URL_EXPIRES_IN);

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

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {items.map((item) => {
        const representativePath = item.clothing_images[0]?.image_path ?? null;
        const imageUrl = representativePath
          ? (signedUrlMap.get(representativePath) ?? null)
          : null;

        return (
          <Link key={item.id} href={`/protected/items/${item.id}`}>
            <ClothingItemCard
              title={item.title}
              brand={item.brand}
              category={item.category}
              season={item.season}
              favorite={item.favorite}
              status={item.status}
              imageUrl={imageUrl}
            />
          </Link>
        );
      })}
    </div>
  );
}

export default function ClothingItemsPage() {
  return (
    <div className="w-full flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">クローゼット一覧</h1>
        <Button asChild>
          <Link href="/protected/items/new">服を登録</Link>
        </Button>
      </div>

      <Suspense
        fallback={
          <p className="text-sm text-muted-foreground">読み込み中...</p>
        }
      >
        <ClothingItemsList />
      </Suspense>
    </div>
  );
}
