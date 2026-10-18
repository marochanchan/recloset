import { AiDiagnosisFlow } from "@/components/ai-diagnosis-flow";
import { DoodleSparkle } from "@/components/doodle-icons";
import { formatSeasons, getCategoryLabel } from "@/lib/clothing-options";
import { getCurrentClaims } from "@/lib/supabase/current-user";
import { createClient } from "@/lib/supabase/server";
import { getPrivateSignedImageUrls } from "@/lib/supabase/signed-image-urls";
import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function AiDiagnosisContent({
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
      "id, title, brand, category, seasons, favorite, status, clothing_images(image_path, sort_order)",
    )
    .eq("id", id)
    .order("sort_order", { referencedTable: "clothing_images" })
    .limit(1, { referencedTable: "clothing_images" })
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!item) {
    notFound();
  }

  // 写真を主役に表示するため、代表画像（sort_orderが最小の1枚）だけ署名付きURLを発行する。
  // 取得できなくても診断はそのまま使える（写真なしの表示にする）
  const coverPath = item.clothing_images[0]?.image_path ?? null;
  let imageUrl: string | null = null;
  if (coverPath) {
    const claims = await getCurrentClaims();
    const urlByPath = await getPrivateSignedImageUrls(
      supabase,
      claims?.sub,
      [coverPath],
      "ai diagnosis",
    );
    imageUrl = urlByPath.get(coverPath) ?? null;
  }

  return (
    <div className="flex flex-col gap-4">
      <Link
        href={`/protected/items/${item.id}`}
        className="-ml-1 flex min-h-10 w-fit items-center gap-1 rounded-lg pr-2 text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ChevronLeft className="h-4 w-4" aria-hidden="true" />
        服の詳細
      </Link>

      <h1 className="flex items-center gap-2 text-xl font-semibold">
        <DoodleSparkle size={24} className="text-blush-foreground" />
        AIと一緒に見直す
      </h1>

      <AiDiagnosisFlow
        itemId={item.id}
        title={item.title}
        brand={item.brand}
        categoryLabel={getCategoryLabel(item.category)}
        seasonLabel={formatSeasons(item.seasons)}
        favorite={item.favorite}
        currentStatus={item.status}
        imageUrl={imageUrl}
      />
    </div>
  );
}

export default function AiDiagnosisPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <div className="w-full max-w-md mx-auto flex flex-col gap-4">
      <Suspense
        fallback={
          <p className="text-sm text-muted-foreground">読み込み中...</p>
        }
      >
        <AiDiagnosisContent params={params} />
      </Suspense>
    </div>
  );
}
