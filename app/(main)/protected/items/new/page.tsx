import { NewClothingItemForm } from "@/components/clothing-item-form";
import { ClothingFormSkeleton } from "@/components/loading-skeletons";
import { Button } from "@/components/ui/button";
import {
  isDraftId,
  isDraftImagePath,
  normalizeDraftFields,
  MAX_DRAFT_IMAGES,
} from "@/lib/clothing-drafts";
import { getCurrentClaims } from "@/lib/supabase/current-user";
import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { Suspense } from "react";

type SearchParamsPromise = Promise<{
  [key: string]: string | string[] | undefined;
}>;

function DraftNotFound() {
  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed px-4 py-10 text-center">
      <p className="font-medium">下書きが見つかりませんでした</p>
      <p className="text-sm text-muted-foreground">
        削除されたか、登録が完了した下書きの可能性があります。
      </p>
      <div className="flex flex-wrap justify-center gap-2">
        <Button asChild variant="outline" size="sm">
          <Link href="/protected/items/drafts">下書き一覧</Link>
        </Button>
        <Button asChild size="sm">
          <Link href="/protected/items/new">新しく登録する</Link>
        </Button>
      </div>
    </div>
  );
}

// ?draft=<id> があれば、本人の下書きを読み込んでフォームに渡す
// （RLSにより、他のユーザーの下書きIDを指定しても取得できない）
async function NewClothingItemContent({
  searchParams,
}: {
  searchParams: SearchParamsPromise;
}) {
  const { draft: rawDraftId, mode } = await searchParams;
  if (rawDraftId === undefined) {
    // ?mode=photo（Closet・見直し画面の「写真だけで登録」）なら、写真だけで登録する画面で開く
    return (
      <NewClothingItemForm entryMode={mode === "photo" ? "photo" : "normal"} />
    );
  }
  if (!isDraftId(rawDraftId)) {
    return <DraftNotFound />;
  }

  const claims = await getCurrentClaims();
  const userId = claims?.sub;
  if (!userId) {
    return <DraftNotFound />;
  }

  const supabase = await createClient();
  const { data: draft, error } = await supabase
    .from("clothing_item_drafts")
    .select("id, fields, image_paths")
    .eq("id", rawDraftId)
    .maybeSingle();

  if (error) {
    console.error("load clothing draft error:", error);
  }
  if (error || !draft) {
    return <DraftNotFound />;
  }

  // 写真は本人のこの下書きのフォルダにあるものだけを使う
  const imagePaths = (Array.isArray(draft.image_paths) ? draft.image_paths : [])
    .filter((path: unknown) => isDraftImagePath(path, userId, draft.id))
    .slice(0, MAX_DRAFT_IMAGES);

  return (
    <NewClothingItemForm
      draft={{
        id: draft.id,
        fields: normalizeDraftFields(draft.fields),
        imagePaths,
      }}
    />
  );
}

// 保存中の下書きがあるときだけ、下書き一覧への控えめな案内を出す。
// 再開中の下書き自身は数えない。件数を取得できない場合は何も出さない
// （登録フォームはそのまま使える）。リンクでの移動には、フォーム側の
// 未保存時の離脱確認がそのまま効く。
async function DraftsNotice({
  searchParams,
}: {
  searchParams: SearchParamsPromise;
}) {
  const { draft: currentDraftId } = await searchParams;
  const supabase = await createClient();
  let query = supabase
    .from("clothing_item_drafts")
    .select("*", { count: "exact", head: true });
  if (isDraftId(currentDraftId)) {
    query = query.neq("id", currentDraftId);
  }
  const { count, error } = await query;
  if (error || !count) return null;

  return (
    <p className="mb-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
      <span>保存中の下書きが{count}件あります</span>
      <Link
        href="/protected/items/drafts"
        className="underline underline-offset-4 hover:text-foreground"
      >
        下書きを見る →
      </Link>
    </p>
  );
}

export default function NewClothingItemPage({
  searchParams,
}: {
  searchParams: SearchParamsPromise;
}) {
  return (
    <div className="w-full max-w-md mx-auto">
      <Suspense fallback={null}>
        <DraftsNotice searchParams={searchParams} />
      </Suspense>
      <Suspense fallback={<ClothingFormSkeleton />}>
        <NewClothingItemContent searchParams={searchParams} />
      </Suspense>
    </div>
  );
}
