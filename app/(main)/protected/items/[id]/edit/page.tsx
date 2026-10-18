import { ClothingItemForm } from "@/components/clothing-item-form";
import { getCurrentClaims } from "@/lib/supabase/current-user";
import { createClient } from "@/lib/supabase/server";
import { getPrivateSignedImageUrls } from "@/lib/supabase/signed-image-urls";
import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
      "id, title, brand, category, subcategory, main_color, seasons, purchase_date, purchase_price, favorite, mercari_url, rakuma_url, yahoo_furima_url, clothing_images(id, image_path, sort_order)",
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

  const claims = await getCurrentClaims();
  const signedUrlMap = await getPrivateSignedImageUrls(
    supabase,
    claims?.sub,
    item.clothing_images.map((img) => img.image_path),
    "edit clothing image",
  );

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
        className="-ml-1 flex min-h-10 w-fit items-center gap-1 rounded-lg pr-2 text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        服の詳細
      </Link>

      <ClothingItemForm
        mode="edit"
        itemId={item.id}
        initialValues={{
          title: item.title,
          brand: item.brand,
          category: item.category,
          subcategory: item.subcategory ?? null,
          mainColor: item.main_color ?? null,
          seasons: item.seasons ?? [],
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
