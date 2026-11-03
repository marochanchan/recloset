import { OutfitEditForm } from "@/components/outfit-edit-form";
import type { PickerItem } from "@/components/outfit-item-picker";
import { createClient } from "@/lib/supabase/server";
import { getPrivateSignedImageUrls } from "@/lib/supabase/signed-image-urls";
import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function EditLookContent({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID_PATTERN.test(id)) {
    notFound();
  }

  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;

  const { data: outfit, error } = await supabase
    .from("outfits")
    .select("id, worn_on, status, note, revision")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    throw error;
  }
  if (!outfit) {
    notFound();
  }
  // 未確定の着画は、ここでは直せない（詳細へ戻す）
  if (outfit.status !== "confirmed") {
    redirect(`/protected/looks/${id}`);
  }

  const { data: links, error: linksError } = await supabase
    .from("outfit_items")
    .select("item_id")
    .eq("outfit_id", id);
  if (linksError) {
    throw linksError;
  }
  const currentIds = (links ?? []).map((l) => l.item_id as string);

  // しまっていない服 + 今この着画に入っている服（しまった服も外せるように）
  const { data: rows, error: itemsError } = await supabase
    .from("clothing_items")
    .select("id, title, category, archived_at, clothing_images(image_path, sort_order)")
    .order("created_at", { ascending: false })
    .order("sort_order", { referencedTable: "clothing_images" });
  if (itemsError) {
    throw itemsError;
  }
  const usable = rows.filter((row) => row.archived_at === null || currentIds.includes(row.id));

  const urlByPath = await getPrivateSignedImageUrls(
    supabase,
    userId,
    usable.map((row) => row.clothing_images[0]?.image_path).filter((p): p is string => Boolean(p)),
    "edit look item picker",
  );

  const items: PickerItem[] = usable.map((row) => {
    const path = row.clothing_images[0]?.image_path;
    return {
      id: row.id,
      title: row.title,
      category: row.category,
      imageUrl: path ? (urlByPath.get(path) ?? null) : null,
    };
  });

  return (
    <OutfitEditForm
      outfitId={outfit.id}
      revision={outfit.revision}
      wornOn={outfit.worn_on}
      note={outfit.note}
      items={items}
      initialItemIds={currentIds}
    />
  );
}

export default function EditLookPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <div className="w-full max-w-md mx-auto flex flex-col gap-6">
      <Suspense fallback={null}>
        <BackLink params={params} />
      </Suspense>
      <h1 className="text-xl font-semibold">着た服を直す</h1>
      <Suspense fallback={<p className="text-sm text-muted-foreground">読み込んでいます</p>}>
        <EditLookContent params={params} />
      </Suspense>
    </div>
  );
}

async function BackLink({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <Link
      href={UUID_PATTERN.test(id) ? `/protected/looks/${id}` : "/protected/looks"}
      className="-ml-1 flex min-h-10 w-fit items-center gap-1 rounded-lg pr-2 text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
    >
      <ChevronLeft className="h-4 w-4" aria-hidden="true" />
      着画
    </Link>
  );
}
