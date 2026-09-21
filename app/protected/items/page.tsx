import { ClothingItemCard } from "@/components/clothing-item-card";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { Suspense } from "react";

async function ClothingItemsList() {
  const supabase = await createClient();
  const { data: items, error } = await supabase
    .from("clothing_items")
    .select("id, title, brand, category, season, favorite, status")
    .order("created_at", { ascending: false });

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

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {items.map((item) => (
        <ClothingItemCard
          key={item.id}
          title={item.title}
          brand={item.brand}
          category={item.category}
          season={item.season}
          favorite={item.favorite}
          status={item.status}
        />
      ))}
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
