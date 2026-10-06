import { AiDiagnosisFlow } from "@/components/ai-diagnosis-flow";
import { getCategoryLabel, getSeasonLabel } from "@/lib/clothing-options";
import { createClient } from "@/lib/supabase/server";
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
      "id, title, brand, category, season, favorite, status",
    )
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!item) {
    notFound();
  }

  return (
    <div className="flex flex-col gap-6">
      <Link
        href={`/protected/items/${item.id}`}
        className="text-sm underline underline-offset-4 text-muted-foreground w-fit"
      >
        ← 服の詳細に戻る
      </Link>

      <AiDiagnosisFlow
        itemId={item.id}
        title={item.title}
        brand={item.brand}
        categoryLabel={getCategoryLabel(item.category)}
        seasonLabel={item.season ? getSeasonLabel(item.season) : null}
        favorite={item.favorite}
        currentStatus={item.status}
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
    <div className="w-full max-w-md mx-auto flex flex-col gap-6">
      <h1 className="text-2xl font-bold">AI診断</h1>

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
