import { timingSafeEqual } from "node:crypto";
import { readCloudflareConfig } from "@/lib/media/cloudflare-config";
import { createCloudflareApi } from "@/lib/media/cloudflare-api";
import { createCloudflareMediaStore } from "@/lib/media/media-store";
import { createSupabaseDeletionQueueDeps, processMediaDeletionQueue } from "@/lib/media/deletion-queue";
import { createAdminClient } from "@/lib/supabase/admin";

// Vercel Cron が毎日呼ぶ。削除待ちの Cloudflare 資産を消す。
function isAuthorized(header: string | null): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret || !header) return false; // 未設定・空の秘密とは比べない
  const expected = Buffer.from(`Bearer ${secret}`);
  const actual = Buffer.from(header);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export async function GET(request: Request) {
  if (!isAuthorized(request.headers.get("authorization"))) {
    return new Response(null, { status: 401 });
  }
  try {
    const config = readCloudflareConfig();
    const store = createCloudflareMediaStore(config, createCloudflareApi(config));
    const deps = { ...createSupabaseDeletionQueueDeps(createAdminClient()), store };
    const result = await processMediaDeletionQueue(deps);
    return Response.json(result);
  } catch (error) {
    // 外部の文面が入りうるので message は出さない
    console.error("media deletion cron failed", { name: error instanceof Error ? error.name : "unknown" });
    return new Response(null, { status: 500 });
  }
}
