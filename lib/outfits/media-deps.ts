import "server-only";

import { createCloudflareApi } from "@/lib/media/cloudflare-api";
import { readCloudflareConfig } from "@/lib/media/cloudflare-config";
import { createCloudflareMediaStore, type MediaStore } from "@/lib/media/media-store";
import { createSupabaseOutfitMediaDb } from "@/lib/outfits/media-db";
import type { MediaServiceDeps } from "@/lib/outfits/media-service";
import { createAdminClient } from "@/lib/supabase/admin";
import type { SupabaseClient } from "@supabase/supabase-js";

// 着画のアップロードに使う部品を、設定の読み込みからまとめて組み立てる（サーバー専用）。
// Cloudflare の設定が足りないときは例外になる。例外の文面に環境変数名が入るので、画面には出さない。
export function createOutfitMediaDeps(): {
  admin: SupabaseClient;
  store: MediaStore;
  deps: MediaServiceDeps;
} {
  const config = readCloudflareConfig();
  const store = createCloudflareMediaStore(config, createCloudflareApi(config));
  const admin = createAdminClient();
  return {
    admin,
    store,
    deps: { db: createSupabaseOutfitMediaDb(admin), store, now: () => new Date() },
  };
}

// 写真を表示するだけのページ用。設定が足りなければ null（ページは写真なしで表示を続ける）
export function tryCreateMediaStore(): MediaStore | null {
  try {
    const config = readCloudflareConfig();
    return createCloudflareMediaStore(config, createCloudflareApi(config));
  } catch {
    console.error("outfit media: cloudflare config unavailable");
    return null;
  }
}
