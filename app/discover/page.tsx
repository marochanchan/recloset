import {
  DiscoverHeroActions,
  DiscoverStickyCta,
} from "@/components/discover-cta";
import { ItemGridSkeleton } from "@/components/loading-skeletons";
import { PublicClothingItemCard } from "@/components/public-clothing-item-card";
import { createClient } from "@/lib/supabase/server";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

export const metadata: Metadata = {
  title: "Re:Closet Loop",
  description:
    "服を手放すことは、捨てることじゃない。Re:Closetのユーザーが手放そうとしている服を、次の人へつなぐ場所です。",
};

const SIGNED_URL_EXPIRES_IN = 600; // 10分
const PUBLIC_ITEMS_LIMIT = 50;

// list_public_clothing_items（migration 008）の戻り値。
// 公開してよい列だけを返すRPCで、user_id・購入情報・着用情報・statusは含まない。
type PublicClothingItemRow = {
  id: string;
  title: string;
  brand: string | null;
  category: string;
  season: string | null;
  published_at: string;
  owner_display_name: string | null;
  cover_image_path: string | null;
};

async function PublicClothingItemsList() {
  // cookies()を経由するため動的レンダリングになり、署名付きURLが
  // ビルド時に固定されることはない。公開データはRPCからのみ取得し、
  // clothing_items等のテーブルは直接参照しない。
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("list_public_clothing_items", {
    p_limit: PUBLIC_ITEMS_LIMIT,
  });

  if (error) {
    throw error;
  }

  const items = (data ?? []) as PublicClothingItemRow[];

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-1 rounded-lg border border-dashed px-4 py-10 text-center">
        <p className="font-medium">まだ公開されている服はありません</p>
        <p className="text-sm text-muted-foreground">
          ユーザーが服を公開すると、ここに並びます。
        </p>
      </div>
    );
  }

  const coverPaths = items
    .map((item) => item.cover_image_path)
    .filter((path): path is string => Boolean(path));

  const signedUrlMap = new Map<string, string>();

  if (coverPaths.length > 0) {
    // private bucketのまま、公開服の画像だけを許可するStorageポリシー
    // （migration 008）により署名付きURLを発行する
    const { data: signedUrls, error: signError } = await supabase.storage
      .from("clothing-images")
      .createSignedUrls(coverPaths, SIGNED_URL_EXPIRES_IN);

    if (signError) {
      console.error("public clothing image signed url error:", signError);
    } else {
      for (const entry of signedUrls) {
        if (entry.error || !entry.path || !entry.signedUrl) {
          console.error("public clothing image signed url entry error:", entry);
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

export default function DiscoverPage() {
  return (
    <div className="w-full flex flex-col gap-8">
      <section className="flex flex-col items-center gap-4 rounded-xl border bg-muted/30 px-5 py-8 text-center sm:py-10">
        <h1 className="text-3xl font-bold tracking-tight">Re:Closet Loop</h1>
        <p className="max-w-md text-muted-foreground leading-relaxed">
          服を手放すことは、捨てることじゃない。
          <br />
          誰かのクローゼットへ、次の一着をつなごう。
        </p>
        <Suspense fallback={<div className="h-10" />}>
          <DiscoverHeroActions />
        </Suspense>
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold">誰かのクローゼットをのぞいてみる</h2>
        <Suspense fallback={<ItemGridSkeleton variant="discover" />}>
          <PublicClothingItemsList />
        </Suspense>
      </section>

      <Suspense fallback={null}>
        <DiscoverStickyCta />
      </Suspense>
    </div>
  );
}
