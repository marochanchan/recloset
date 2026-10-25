"use server";

import { processMediaDeletionQueue, createSupabaseDeletionQueueDeps } from "@/lib/media/deletion-queue";
import {
  completeMediaUpload,
  MediaNotFoundError,
  MediaNotUploadedError,
  MediaUploadConflictError,
  retryMediaUpload,
  startMediaUpload,
} from "@/lib/outfits/media-service";
import { createOutfitMediaDeps } from "@/lib/outfits/media-deps";
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { after } from "next/server";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_ITEMS = 50;
const MAX_NOTE_LENGTH = 500;

const GENERIC_ERROR = "うまく進められませんでした。時間をおいて、もう一度お試しください";
const NOT_LOGGED_IN_ERROR = "ログインし直してから、もう一度お試しください";
const CONFLICT_ERROR = "ほかの送信と重なりました。少し待ってから、もう一度送ってください";
const NOT_UPLOADED_ERROR = "写真がまだ届いていません。もう一度送ってください";
const MEDIA_NOT_FOUND_ERROR = "写真が見つかりませんでした。もう一度送ってください";
const INVALID_INPUT_ERROR = "入力の内容を確かめて、もう一度お試しください";

type ErrorResult = { error: string };

// ログイン中のユーザー ID（claims の sub）。未ログインなら null
async function getUserId() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  return { supabase, userId: typeof userId === "string" ? userId : null };
}

function isValidDate(value: unknown): value is string {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

// アップロード系の例外を、画面に出してよい言葉にする。生の文面は出さず、固定の文字列だけ記録する
function mapUploadError(error: unknown, label: string): ErrorResult {
  if (error instanceof MediaUploadConflictError) return { error: CONFLICT_ERROR };
  if (error instanceof MediaNotUploadedError) return { error: NOT_UPLOADED_ERROR };
  if (error instanceof MediaNotFoundError) return { error: MEDIA_NOT_FOUND_ERROR };
  console.error(`${label}: failed`);
  return { error: GENERIC_ERROR };
}

export async function startOutfitPhotoUpload(input: {
  clientRequestId: string;
  mediaId: string;
  wornOn: string;
}): Promise<{ outfitId: string; mediaId: string; uploadUrl: string | null } | ErrorResult> {
  const { supabase, userId } = await getUserId();
  if (!userId) return { error: NOT_LOGGED_IN_ERROR };

  if (
    !UUID_PATTERN.test(String(input?.clientRequestId)) ||
    !UUID_PATTERN.test(String(input?.mediaId)) ||
    !isValidDate(input?.wornOn)
  ) {
    return { error: INVALID_INPUT_ERROR };
  }

  // 設定が足りないときに下書きだけが残らないよう、先に部品を組み立てる
  let mediaDeps;
  try {
    mediaDeps = createOutfitMediaDeps();
  } catch {
    console.error("startOutfitPhotoUpload: media deps unavailable");
    return { error: GENERIC_ERROR };
  }

  const { data: outfit, error: draftError } = await supabase.rpc("create_outfit_draft", {
    p_client_request_id: input.clientRequestId,
    p_worn_on: input.wornOn,
    p_source: "upload",
  });
  if (draftError || !outfit?.id) {
    console.error("startOutfitPhotoUpload: create_outfit_draft failed", draftError?.code);
    return { error: GENERIC_ERROR };
  }

  try {
    const result = await startMediaUpload(mediaDeps.deps, {
      userId,
      mediaId: input.mediaId,
      outfitId: outfit.id as string,
      kind: "photo",
      takenAt: null,
      sortOrder: 0,
    });
    // 返すのは uploadUrl と、こちらで決めた ID だけ（Cloudflare の ID は返さない）
    return { outfitId: outfit.id as string, mediaId: result.mediaId, uploadUrl: result.uploadUrl };
  } catch (error) {
    return mapUploadError(error, "startOutfitPhotoUpload");
  }
}

export async function completeOutfitMedia(input: {
  mediaId: string;
  width: number;
  height: number;
}): Promise<{ ok: true } | ErrorResult> {
  const { userId } = await getUserId();
  if (!userId) return { error: NOT_LOGGED_IN_ERROR };

  if (
    !UUID_PATTERN.test(String(input?.mediaId)) ||
    !Number.isInteger(input.width) ||
    !Number.isInteger(input.height) ||
    input.width < 1 ||
    input.height < 1 ||
    input.width > 20000 ||
    input.height > 20000
  ) {
    return { error: INVALID_INPUT_ERROR };
  }

  try {
    const { deps } = createOutfitMediaDeps();
    await completeMediaUpload(deps, {
      userId,
      mediaId: input.mediaId,
      width: input.width,
      height: input.height,
    });
    return { ok: true };
  } catch (error) {
    return mapUploadError(error, "completeOutfitMedia");
  }
}

export async function retryOutfitMedia(input: {
  mediaId: string;
}): Promise<{ uploadUrl: string | null } | ErrorResult> {
  const { userId } = await getUserId();
  if (!userId) return { error: NOT_LOGGED_IN_ERROR };

  if (!UUID_PATTERN.test(String(input?.mediaId))) {
    return { error: INVALID_INPUT_ERROR };
  }

  try {
    const { deps, admin, store } = createOutfitMediaDeps();
    const result = await retryMediaUpload(deps, { userId, mediaId: input.mediaId });
    if (result.uploadUrl !== null) {
      // 新しい試行に置き換えたので、削除待ちに入った古い ID をすぐ消しにいく（失敗しても本筋は止めない）
      after(async () => {
        try {
          await processMediaDeletionQueue({ ...createSupabaseDeletionQueueDeps(admin), store });
        } catch {
          console.error("retryOutfitMedia: deletion queue run failed");
        }
      });
    }
    return { uploadUrl: result.uploadUrl };
  } catch (error) {
    return mapUploadError(error, "retryOutfitMedia");
  }
}

export async function confirmOutfitAction(input: {
  outfitId: string;
  expectedRevision: number;
  wornOn: string;
  itemIds: string[];
  note: string | null;
}): Promise<{ status: "confirmed" | "unchanged" | "stale"; revision: number } | ErrorResult> {
  const { supabase, userId } = await getUserId();
  if (!userId) return { error: NOT_LOGGED_IN_ERROR };

  const note = typeof input?.note === "string" ? input.note.trim() : null;
  if (
    !UUID_PATTERN.test(String(input?.outfitId)) ||
    !Number.isInteger(input.expectedRevision) ||
    input.expectedRevision < 0 ||
    !isValidDate(input.wornOn) ||
    !Array.isArray(input.itemIds) ||
    input.itemIds.length > MAX_ITEMS ||
    !input.itemIds.every((id) => UUID_PATTERN.test(String(id))) ||
    (note !== null && note.length > MAX_NOTE_LENGTH)
  ) {
    return { error: INVALID_INPUT_ERROR };
  }

  const { data, error } = await supabase.rpc("confirm_outfit", {
    p_outfit_id: input.outfitId,
    p_expected_revision: input.expectedRevision,
    p_worn_on: input.wornOn,
    p_item_ids: input.itemIds,
    p_note: note || null,
  });

  if (error) {
    // 固定の message だけで見分け、生の文面は出さない・記録しない
    switch (error.message) {
      case "item_not_found":
        return { error: "選んだ服が見つかりませんでした。一覧を開き直してください" };
      case "outfit_not_found":
        return { error: "このコーデが見つかりませんでした" };
      case "invalid_revision":
        return { error: "画面が古くなっています。開き直してください" };
      default:
        console.error("confirmOutfitAction: confirm_outfit failed", error.code);
        return { error: GENERIC_ERROR };
    }
  }

  const status = (data as { status?: unknown } | null)?.status;
  const revision = (data as { revision?: unknown } | null)?.revision;
  if (
    (status !== "confirmed" && status !== "unchanged" && status !== "stale") ||
    typeof revision !== "number"
  ) {
    console.error("confirmOutfitAction: unexpected result");
    return { error: GENERIC_ERROR };
  }

  if (status === "confirmed") {
    revalidatePath(`/protected/looks/${input.outfitId}`);
    for (const itemId of new Set(input.itemIds)) {
      revalidatePath(`/protected/items/${itemId}`);
    }
  }
  return { status, revision };
}
