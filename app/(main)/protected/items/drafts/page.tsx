import { ClothingDraftCard } from "@/components/clothing-draft-delete-button";
import { DraftListSkeleton } from "@/components/loading-skeletons";
import {
  CLOTHING_IMAGE_BUCKET,
  normalizeDraftFields,
} from "@/lib/clothing-drafts";
import { getCategoryLabel } from "@/lib/clothing-options";
import { createClient } from "@/lib/supabase/server";
import { formatJstDate } from "@/lib/wear-logs";
import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Suspense } from "react";

export const metadata: Metadata = {
  title: "下書き | Re:Closet",
};

const SIGNED_URL_EXPIRES_IN = 600; // 10分

// 本人の下書き一覧（RLSにより本人の行だけが返る）
async function DraftList() {
  const supabase = await createClient();
  const { data: drafts, error } = await supabase
    .from("clothing_item_drafts")
    .select("id, fields, image_paths, updated_at")
    .order("updated_at", { ascending: false });

  if (error) {
    console.error("list clothing drafts error:", error);
    return (
      <p className="text-sm text-muted-foreground">
        下書きを読み込めませんでした。時間をおいてお試しください。
      </p>
    );
  }

  if (drafts.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed px-4 py-10 text-center">
        <p className="font-medium">下書きはありません</p>
        <p className="text-sm text-muted-foreground">
          服の登録画面で「下書きとして保存」すると、ここに並びます。
        </p>
      </div>
    );
  }

  // 1枚目の写真だけをサムネイルにする
  const coverPaths = drafts
    .map((draft) => (Array.isArray(draft.image_paths) ? draft.image_paths[0] : null))
    .filter((path): path is string => typeof path === "string");
  const urlByPath = new Map<string, string>();
  if (coverPaths.length > 0) {
    const { data: signed, error: signError } = await supabase.storage
      .from(CLOTHING_IMAGE_BUCKET)
      .createSignedUrls(coverPaths, SIGNED_URL_EXPIRES_IN);
    if (signError) {
      console.error("draft cover signed url error:", signError);
    } else {
      for (const entry of signed) {
        if (!entry.error && entry.path && entry.signedUrl) {
          urlByPath.set(entry.path, entry.signedUrl);
        }
      }
    }
  }

  return (
    <ul className="flex flex-col gap-3">
      {drafts.map((draft) => {
        const fields = normalizeDraftFields(draft.fields);
        const paths: string[] = Array.isArray(draft.image_paths)
          ? draft.image_paths
          : [];
        const coverUrl = paths[0] ? urlByPath.get(paths[0]) : undefined;
        return (
          <li key={draft.id}>
            <ClothingDraftCard draftId={draft.id}>
              <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-md bg-muted">
                {coverUrl ? (
                  <Image
                    src={coverUrl}
                    alt=""
                    fill
                    sizes="64px"
                    className="object-contain"
                    style={{ objectFit: "contain" }}
                  />
                ) : (
                  <span className="flex h-full items-center justify-center text-[10px] text-muted-foreground">
                    写真なし
                  </span>
                )}
              </div>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <p className="truncate text-sm font-medium">
                  {fields.title || "（タイトル未入力）"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {fields.category ? getCategoryLabel(fields.category) : "カテゴリー未選択"}
                  ・写真{paths.length}枚・{formatJstDate(draft.updated_at)}保存
                </p>
              </div>
            </ClothingDraftCard>
          </li>
        );
      })}
    </ul>
  );
}

export default function ClothingDraftsPage() {
  return (
    <div className="w-full max-w-md mx-auto flex flex-col gap-6">
      <Link
        href="/protected/items"
        className="text-sm underline underline-offset-4 text-muted-foreground w-fit"
      >
        ← クローゼット一覧に戻る
      </Link>
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold">下書き</h1>
        <p className="text-sm text-muted-foreground">
          登録の途中で保存した服です。続きから入力して登録できます。
        </p>
      </div>
      <Suspense fallback={<DraftListSkeleton />}>
        <DraftList />
      </Suspense>
    </div>
  );
}
