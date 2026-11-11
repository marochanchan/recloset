"use server";

import { processMediaDeletionQueue, createSupabaseDeletionQueueDeps } from "@/lib/media/deletion-queue";
import { addMediaToDraft, isValidCompleteSize, OutfitNotDraftError, parseAddMediaInput } from "@/lib/outfits/add-media";
import {
  completeMediaUpload,
  MediaNotFoundError,
  MediaNotUploadedError,
  MediaUploadConflictError,
  retryMediaUpload,
  startMediaUpload,
} from "@/lib/outfits/media-service";
import { outfitPathsToRevalidate } from "@/lib/outfits/revalidate";
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

// 確定前のコーデに、2枚目以降の写真と動画を足す（コマ選びのあと、確定のときに呼ぶ）。
// 同じ mediaId で2回呼ばれても壊れない（既にあれば送り直しに回る）
export async function addOutfitMediaUpload(input: {
  outfitId: string;
  mediaId: string;
  kind: "photo" | "video";
  sortOrder: number;
}): Promise<{ mediaId: string; uploadUrl: string | null } | ErrorResult> {
  const { supabase, userId } = await getUserId();
  if (!userId) return { error: NOT_LOGGED_IN_ERROR };

  const parsed = parseAddMediaInput(input);
  if (!parsed.ok) return { error: INVALID_INPUT_ERROR };

  let mediaDeps;
  try {
    mediaDeps = createOutfitMediaDeps();
  } catch {
    console.error("addOutfitMediaUpload: media deps unavailable");
    return { error: GENERIC_ERROR };
  }

  try {
    return await addMediaToDraft(mediaDeps.deps, {
      ...parsed.value,
      userId,
      // 本人の下書きか。outfits は RLS で本人の行しか見えない（他人の ID は「ない」と同じ）。
      // さらに register_outfit_media も持ち主を確かめる
      isOwnDraft: async (outfitId) => {
        const { data, error } = await supabase
          .from("outfits")
          .select("id")
          .eq("id", outfitId)
          .eq("user_id", userId)
          .eq("status", "pending")
          .maybeSingle();
        if (error) throw error;
        return data !== null;
      },
    });
  } catch (error) {
    if (error instanceof OutfitNotDraftError) {
      return { error: "このコーデには、もう写真や動画を足せません。開き直してください" };
    }
    return mapUploadError(error, "addOutfitMediaUpload");
  }
}

// width / height は写真のとき必須。動画は Stream が持つ寸法を使うので省いてよい（2つとも省く）。判定は isValidCompleteSize
export async function completeOutfitMedia(input: {
  mediaId: string;
  width?: number;
  height?: number;
}): Promise<{ ok: true } | ErrorResult> {
  const { userId } = await getUserId();
  if (!userId) return { error: NOT_LOGGED_IN_ERROR };

  const noSize = input?.width === undefined && input?.height === undefined;
  if (!UUID_PATTERN.test(String(input?.mediaId))) return { error: INVALID_INPUT_ERROR };

  // 寸法の省略は動画だけ。本人のメディアの種類を見て決める（他人の ID は「見つからない」）
  try {
    const { deps } = createOutfitMediaDeps();
    const row = await deps.db.getMedia(userId, input.mediaId);
    if (!row) return { error: MEDIA_NOT_FOUND_ERROR };
    if (!isValidCompleteSize(row.kind, input.width, input.height)) return { error: INVALID_INPUT_ERROR };
  } catch (error) {
    return mapUploadError(error, "completeOutfitMedia");
  }

  try {
    const { deps } = createOutfitMediaDeps();
    await completeMediaUpload(deps, {
      userId,
      mediaId: input.mediaId,
      ...(noSize ? {} : { width: input.width, height: input.height }),
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

  // 編集（服を外す）のとき、外した服の画面も新しくするため、直す前の服を控えておく。
  // 取れなくても確定は止めない（その場合は今の服の画面だけ新しくなる）
  let previousItemIds: string[] = [];
  if (input.expectedRevision > 0) {
    const { data: prev } = await supabase
      .from("outfit_items")
      .select("item_id")
      .eq("outfit_id", input.outfitId);
    previousItemIds = (prev ?? []).map((row) => row.item_id as string);
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

  for (const path of outfitPathsToRevalidate(status, input.outfitId, input.itemIds, previousItemIds)) {
    revalidatePath(path);
  }
  return { status, revision };
}

// 着画を消す（確定済みでも未確定でも）。写真は RPC が削除待ちに入れるので、ここでキューを回して消しにいく
export async function deleteOutfitAction(input: {
  outfitId: string;
}): Promise<{ ok: true } | ErrorResult> {
  const { supabase, userId } = await getUserId();
  if (!userId) return { error: NOT_LOGGED_IN_ERROR };

  if (!UUID_PATTERN.test(String(input?.outfitId))) {
    return { error: INVALID_INPUT_ERROR };
  }

  // 消すと服とのつながりが分からなくなるので、画面を新しくする服を先に控える
  const { data: prev } = await supabase
    .from("outfit_items")
    .select("item_id")
    .eq("outfit_id", input.outfitId);
  const itemIds = (prev ?? []).map((row) => row.item_id as string);

  const { error } = await supabase.rpc("delete_outfit", { p_outfit_id: input.outfitId });
  if (error) {
    switch (error.message) {
      case "outfit_not_found":
        return { error: "この着画が見つかりませんでした。すでに消えているかもしれません" };
      default:
        console.error("deleteOutfitAction: delete_outfit failed", error.code);
        return { error: GENERIC_ERROR };
    }
  }

  for (const path of outfitPathsToRevalidate("confirmed", input.outfitId, [], itemIds)) {
    revalidatePath(path);
  }

  // 削除待ちの写真をすぐ消しにいく（失敗しても本筋は止めない。残りは定期の処理が消す）
  after(async () => {
    try {
      const { admin, store } = createOutfitMediaDeps();
      await processMediaDeletionQueue({ ...createSupabaseDeletionQueueDeps(admin), store });
    } catch {
      console.error("deleteOutfitAction: deletion queue run failed");
    }
  });
  return { ok: true };
}
