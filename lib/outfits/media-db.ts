import type { SupabaseClient } from "@supabase/supabase-js";
import type { MediaProvider } from "@/lib/media/media-store";
import { MediaNotFoundError, MediaStateTransitionError, MediaUploadConflictError } from "@/lib/outfits/media-service";

// outfit_media の読み書き。書き込みはすべて 023 の RPC（service_role 専用）を通す。

export type OutfitMediaRow = {
  id: string;
  outfitId: string;
  userId: string;
  kind: "photo" | "video" | "frame";
  provider: MediaProvider;
  providerAssetId: string;
  uploadAttempt: number;
  uploadExpiresAt: string | null;
  status: "uploading" | "processing" | "ready" | "failed";
  width: number | null;
  height: number | null;
  durationSec: number | null;
};

export interface OutfitMediaDb {
  registerMedia(i: {
    userId: string;
    mediaId: string;
    outfitId: string;
    kind: "photo" | "video";
    provider: MediaProvider;
    assetId: string;
    uploadExpiresAt: Date;
    takenAt: Date | null;
    sortOrder: number;
  }): Promise<OutfitMediaRow>;
  getMedia(userId: string, mediaId: string): Promise<OutfitMediaRow | null>;
  replaceAsset(i: {
    userId: string;
    mediaId: string;
    expectedUploadAttempt: number;
    assetId: string;
    uploadExpiresAt: Date;
  }): Promise<OutfitMediaRow>;
  setState(i: {
    userId: string;
    mediaId: string;
    expectedUploadAttempt: number;
    status: OutfitMediaRow["status"];
    width?: number;
    height?: number;
    durationSec?: number;
  }): Promise<OutfitMediaRow>;
}

type MediaRecord = {
  id: string;
  outfit_id: string;
  user_id: string;
  kind: OutfitMediaRow["kind"];
  provider: MediaProvider;
  provider_asset_id: string;
  upload_attempt: number;
  upload_expires_at: string | null;
  status: OutfitMediaRow["status"];
  width: number | null;
  height: number | null;
  duration_sec: number | string | null;
};

function toRow(r: MediaRecord): OutfitMediaRow {
  return {
    id: r.id,
    outfitId: r.outfit_id,
    userId: r.user_id,
    kind: r.kind,
    provider: r.provider,
    providerAssetId: r.provider_asset_id,
    uploadAttempt: r.upload_attempt,
    uploadExpiresAt: r.upload_expires_at,
    status: r.status,
    width: r.width,
    height: r.height,
    // numeric は文字列で返ることがある
    durationSec: r.duration_sec === null ? null : Number(r.duration_sec),
  };
}

// RPC の固定メッセージを、サービスのエラーに直す
function mapError(error: { message: string }): Error {
  if (error.message.includes("media_conflict") || error.message.includes("media_attempt_changed")) {
    return new MediaUploadConflictError(error.message);
  }
  if (error.message.includes("invalid_media_transition")) return new MediaStateTransitionError(error.message);
  if (error.message.includes("media_not_found")) return new MediaNotFoundError(error.message);
  return new Error(error.message);
}

async function callRpc(admin: SupabaseClient, fn: string, args: Record<string, unknown>) {
  const { data, error } = await admin.rpc(fn, args);
  if (error) throw mapError(error);
  return toRow(data as MediaRecord);
}

export function createSupabaseOutfitMediaDb(admin: SupabaseClient): OutfitMediaDb {
  return {
    registerMedia(i) {
      return callRpc(admin, "register_outfit_media", {
        p_user_id: i.userId,
        p_media_id: i.mediaId,
        p_outfit_id: i.outfitId,
        p_kind: i.kind,
        p_provider: i.provider,
        p_asset_id: i.assetId,
        p_upload_expires_at: i.uploadExpiresAt.toISOString(),
        p_taken_at: i.takenAt ? i.takenAt.toISOString() : null,
        p_sort_order: i.sortOrder,
      });
    },

    async getMedia(userId, mediaId) {
      // outfit_media は新しいテーブルで service_role に SELECT がある
      const { data, error } = await admin
        .from("outfit_media")
        .select("*")
        .eq("id", mediaId)
        .eq("user_id", userId)
        .maybeSingle();
      if (error) throw mapError(error);
      return data ? toRow(data as MediaRecord) : null;
    },

    replaceAsset(i) {
      return callRpc(admin, "replace_outfit_media_asset", {
        p_user_id: i.userId,
        p_media_id: i.mediaId,
        p_expected_upload_attempt: i.expectedUploadAttempt,
        p_asset_id: i.assetId,
        p_upload_expires_at: i.uploadExpiresAt.toISOString(),
      });
    },

    setState(i) {
      return callRpc(admin, "set_outfit_media_state", {
        p_user_id: i.userId,
        p_media_id: i.mediaId,
        p_expected_upload_attempt: i.expectedUploadAttempt,
        p_status: i.status,
        p_width: i.width ?? null,
        p_height: i.height ?? null,
        p_duration_sec: i.durationSec ?? null,
      });
    },
  };
}
