import { ClothingItemForm } from "@/components/clothing-item-form";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SIGNED_URL_EXPIRES_IN = 600; // 10分

async function EditClothingItemContent({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  if (!UUID_PATTERN.test(id)) {
    notFound();
  }

  const supabase = await createClient();
  // RLSにより、自分が所有する服でなければ取得できない
  // （他ユーザーのIDを直接指定した場合もnotFoundになる）
  const { data: item, error } = await supabase
    .from("clothing_items")
    .select(
      "id, title, brand, category, season, purchase_date, purchase_price, favorite, mercari_url, rakuma_url, yahoo_furima_url, clothing_images(id, image_path, sort_order)",
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
      console.error("edit clothing image signed url error:", signError);
    } else {
      for (const entry of signedUrls) {
        if (entry.error || !entry.path || !entry.signedUrl) {
          console.error("edit clothing image signed url entry error:", entry);
          continue;
        }
        signedUrlMap.set(entry.path, entry.signedUrl);
      }
    }
  }

  const initialImages = item.clothing_images
    .map((img) => {
      const url = signedUrlMap.get(img.image_path);
      if (!url) return null;
      return {
        id: img.id,
        imagePath: img.image_path,
        sortOrder: img.sort_order,
        url,
      };
    })
    .filter((img): img is NonNullable<typeof img> => img !== null);

  return (
    <div className="flex flex-col gap-6">
      <Link
        href={`/protected/items/${item.id}`}
        className="text-sm underline underline-offset-4 text-muted-foreground w-fit"
      >
        ← 服の詳細に戻る
      </Link>

      <ClothingItemForm
        mode="edit"
        itemId={item.id}
        initialValues={{
          title: item.title,
          brand: item.brand,
          category: item.category,
          season: item.season,
          purchaseDate: item.purchase_date,
          purchasePrice: item.purchase_price,
          favorite: item.favorite,
          marketplaceUrls: {
            mercari: item.mercari_url,
            rakuma: item.rakuma_url,
            yahooFurima: item.yahoo_furima_url,
          },
        }}
        initialImages={initialImages}
      />
    </div>
  );
}

export default function EditClothingItemPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <div className="w-full max-w-md mx-auto flex flex-col gap-6">
      <Suspense
        fallback={
          <p className="text-sm text-muted-foreground">読み込み中...</p>
        }
      >
        <EditClothingItemContent params={params} />
      </Suspense>
    </div>
  );
}
