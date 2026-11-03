import { OutfitQuickRecordForm } from "@/components/outfit-quick-record-form";
import type { PickerItem } from "@/components/outfit-item-picker";
import { newLookBackLink, parseUuidParam } from "@/lib/outfits/back-links";
import { jstTodayIsoDate } from "@/lib/outfits/dates";
import { createClient } from "@/lib/supabase/server";
import { getPrivateSignedImageUrls } from "@/lib/supabase/signed-image-urls";
import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";

async function NewLookContent({
  searchParams,
}: {
  searchParams: Promise<{ item?: string | string[] }>;
}) {
  const { item } = await searchParams;
  const itemParam = parseUuidParam(item);

  const supabase = await createClient();
  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;

  // しまっていない服だけ（RLS で本人の服だけが返る）
  const { data: rows, error } = await supabase
    .from("clothing_items")
    .select("id, title, category, clothing_images(image_path, sort_order)")
    .is("archived_at", null)
    .order("created_at", { ascending: false })
    .order("sort_order", { referencedTable: "clothing_images" });
  if (error) {
    throw error;
  }

  const urlByPath = await getPrivateSignedImageUrls(
    supabase,
    userId,
    rows.map((row) => row.clothing_images[0]?.image_path).filter((p): p is string => Boolean(p)),
    "new look item picker",
  );

  const items: PickerItem[] = rows.map((row) => {
    const path = row.clothing_images[0]?.image_path;
    return {
      id: row.id,
      title: row.title,
      category: row.category,
      imageUrl: path ? (urlByPath.get(path) ?? null) : null,
    };
  });

  return (
    <OutfitQuickRecordForm
      key={itemParam ?? "none"}
      items={items}
      defaultWornOn={jstTodayIsoDate()}
      preselectedItemId={itemParam}
    />
  );
}

async function NewLookBackLink({
  searchParams,
}: {
  searchParams: Promise<{ item?: string | string[] }>;
}) {
  const { item } = await searchParams;
  const back = newLookBackLink(parseUuidParam(item));
  return (
    <Link
      href={back.href}
      className="-ml-1 flex min-h-10 w-fit items-center gap-1 rounded-lg pr-2 text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
    >
      <ChevronLeft className="h-4 w-4" aria-hidden="true" />
      {back.label}
    </Link>
  );
}

export default function NewLookPage({
  searchParams,
}: {
  searchParams: Promise<{ item?: string | string[] }>;
}) {
  return (
    <div className="w-full max-w-md mx-auto flex flex-col gap-6">
      <Suspense fallback={<span className="min-h-10" />}>
        <NewLookBackLink searchParams={searchParams} />
      </Suspense>
      <h1 className="text-xl font-semibold">着画を記録</h1>
      <Suspense fallback={<p className="text-sm text-muted-foreground">読み込んでいます</p>}>
        <NewLookContent searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
