import { LikeButton } from "@/components/like-button";
import { PublicClothingItemCard } from "@/components/public-clothing-item-card";
import { getMyLoopItemStates } from "@/lib/loop-likes";
import { getCurrentClaims } from "@/lib/supabase/current-user";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";

// Re:Closet Loopの公開服一覧。/discover と未ログインのトップ（/）で共通に使う。
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

export async function LoopFeed() {
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

  // ログイン中だけ、表示中の服の「気になる」状態と自分の服かどうかを
  // まとめて1回で取得する（未ログイン・取得失敗時はボタンを出さない）
  const user = await getCurrentClaims();
  const itemStates = user
    ? await getMyLoopItemStates(
        supabase,
        items.map((item) => item.id),
      )
    : new Map();

  return (
    <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
      {items.map((item) => {
        const imageUrl = item.cover_image_path
          ? (signedUrlMap.get(item.cover_image_path) ?? null)
          : null;
        const state = itemStates.get(item.id);

        // buttonをLinkの中に入れないよう、カード本体のLinkと
        // 「気になる」ボタンを兄弟要素として重ねる
        return (
          <div key={item.id} className="relative h-full">
            <Link href={`/discover/${item.id}`} className="block h-full">
              <PublicClothingItemCard
                title={item.title}
                brand={item.brand}
                category={item.category}
                season={item.season}
                ownerDisplayName={
                  item.owner_display_name ?? "Re:Closetユーザー"
                }
                imageUrl={imageUrl}
              />
            </Link>
            {state && !state.isOwner && (
              <div className="absolute right-2 top-2">
                <LikeButton
                  itemId={item.id}
                  initialLiked={state.isLiked}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
