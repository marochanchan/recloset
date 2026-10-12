import {
  resolveSignedUrls,
  SIGNED_URL_EXPIRES_IN_SECONDS,
  type SignPaths,
} from "@/lib/signed-image-url-cache";
import {
  createClient as createSupabaseClient,
  type SupabaseClient,
} from "@supabase/supabase-js";

// 服画像（private bucket "clothing-images"）の署名付きURLを取得する共通関数。
// キャッシュの仕組みと安全性の考え方は lib/signed-image-url-cache.ts を参照。

const CLOTHING_IMAGE_BUCKET = "clothing-images";

function createSigner(supabase: SupabaseClient, label: string): SignPaths {
  return async (paths) => {
    const urlByPath = new Map<string, string>();
    const { data, error } = await supabase.storage
      .from(CLOTHING_IMAGE_BUCKET)
      .createSignedUrls(paths, SIGNED_URL_EXPIRES_IN_SECONDS);
    if (error) {
      console.error(`${label} signed url error:`, error);
      return urlByPath;
    }
    for (const entry of data) {
      if (entry.error || !entry.path || !entry.signedUrl) {
        console.error(`${label} signed url entry error:`, entry);
        continue;
      }
      urlByPath.set(entry.path, entry.signedUrl);
    }
    return urlByPath;
  };
}

/**
 * 本人の服画像の署名付きURL（path → URL）。
 *
 * - supabase はログイン中ユーザーのセッションを持つクライアント（署名時に
 *   既存のStorage RLSが評価される）
 * - userId は検証済みのclaims（sub）。未ログインなら何も署名しない
 * - paths は、同じリクエストでRLSを通して取得した本人の行の画像パスだけを渡す
 */
export async function getPrivateSignedImageUrls(
  supabase: SupabaseClient,
  userId: string | null | undefined,
  paths: readonly string[],
  label: string,
): Promise<Map<string, string>> {
  if (!userId || paths.length === 0) return new Map();
  return resolveSignedUrls(
    paths,
    { kind: "private", userId },
    createSigner(supabase, label),
    label,
  );
}

// 公開画像はセッションを持たないanonクライアントで署名する。ログイン中の
// 本人が見ても本人用の権限は使わないため、publicキャッシュには
// 「誰でも署名できる＝公開服の画像」（migration 008のStorageポリシー）しか入らない
function createAnonClient(): SupabaseClient {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    },
  );
}

/**
 * 公開服の画像の署名付きURL（path → URL）。閲覧者全員で共有してよいURLだけを返す。
 *
 * paths は、同じリクエストで公開RPC（is_publicで絞り込み済み）から得たものだけを
 * 渡す。公開解除された服はRPCの結果に含まれないため、古いURLは再配布されない。
 */
export async function getPublicSignedImageUrls(
  paths: readonly string[],
  label: string,
): Promise<Map<string, string>> {
  if (paths.length === 0) return new Map();
  return resolveSignedUrls(
    paths,
    { kind: "public" },
    createSigner(createAnonClient(), label),
    label,
  );
}
