import type { SupabaseClient } from "@supabase/supabase-js";
import type { MediaProvider, MediaStore } from "@/lib/media/media-store";

// 削除待ち（media_deletion_queue）の処理。Cloudflare の資産を消し、結果を DB に戻す。

export type QueueRow = {
  id: string;
  claimToken: string;
  provider: MediaProvider;
  providerAssetId: string;
  attempts: number;
};

export type DeletionQueueDeps = {
  claim: (limit: number) => Promise<QueueRow[]>;
  finish: (id: string, claimToken: string, ok: boolean, error: string | null) => Promise<boolean>;
  store: MediaStore;
};

// DB に残す失敗の説明。外部の文面は入れず、エラーの種類と HTTP ステータスだけにする
function describeFailure(error: unknown): string {
  if (error instanceof Error) {
    const status = (error as { status?: unknown }).status;
    return typeof status === "number" ? `${error.name} status=${status}` : error.name;
  }
  return "UnknownError";
}

export async function processMediaDeletionQueue(
  deps: DeletionQueueDeps,
  limit = 20,
): Promise<{ deleted: number; failed: number }> {
  const rows = await deps.claim(limit);
  let deleted = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      // not_found は、すでに消えているということなので成功として扱う
      await deps.store.deleteAsset(row.provider, row.providerAssetId);
    } catch (error) {
      failed++;
      try {
        await deps.finish(row.id, row.claimToken, false, describeFailure(error));
      } catch {
        // 記録に失敗しても、ほかの行は続ける（claim の期限が切れたらやり直される）
      }
      continue;
    }
    try {
      await deps.finish(row.id, row.claimToken, true, null);
      deleted++;
    } catch {
      failed++;
    }
  }
  return { deleted, failed };
}

type ClaimedRow = {
  id: string;
  claim_token: string;
  provider: MediaProvider;
  provider_asset_id: string;
  attempts: number;
};

// Supabase の RPC につないだ claim / finish。cron と、削除直後の after() の両方で使う
export function createSupabaseDeletionQueueDeps(
  admin: SupabaseClient,
): Pick<DeletionQueueDeps, "claim" | "finish"> {
  return {
    async claim(limit) {
      const { data, error } = await admin.rpc("claim_media_deletions", { p_limit: limit });
      if (error) throw new Error("claim_media_deletions failed");
      return ((data ?? []) as ClaimedRow[]).map((r) => ({
        id: r.id,
        claimToken: r.claim_token,
        provider: r.provider,
        providerAssetId: r.provider_asset_id,
        attempts: r.attempts,
      }));
    },
    async finish(id, claimToken, ok, error) {
      const { data, error: rpcError } = await admin.rpc("finish_media_deletion", {
        p_id: id,
        p_claim_token: claimToken,
        p_ok: ok,
        p_error: error,
      });
      if (rpcError) throw new Error("finish_media_deletion failed");
      return data === true;
    },
  };
}
