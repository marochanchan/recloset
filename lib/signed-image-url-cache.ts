// ============================================================
// 服画像の署名付きURLのプロセス内キャッシュ（Supabase非依存）
//
// 目的: createSignedUrls()は呼ぶたびに別のURL（トークン）を返すため、
// 同じ画像でも next/image の最適化キャッシュ・ブラウザキャッシュに当たらず、
// 表示のたびにSupabase Storageから元画像を取り直していた（Egressの増加）。
// 発行から一定時間は同じURLを返し、キャッシュに当たるようにする。
//
// 安全性:
// - privateはキーを「ユーザーID＋画像パス」で分け、パスが本人のフォルダ
//   （{userId}/...）でなければ署名もキャッシュもしない
// - publicは、anonの権限で署名できた画像（公開服の画像）だけを入れる
//   （呼び出し側: lib/supabase/signed-image-urls.ts）
// - キャッシュを引くのは、呼び出し側がRLSを通したデータ取得（本人の行・
//   公開RPC）で得たパスだけ。権限を失った画像（削除・公開解除）のパスは
//   取得結果に含まれないため、キャッシュに残っていても再配布されない
// - 失敗した署名はキャッシュしない
//
// 保持について: メモリ上（globalThis）のため、Vercelのサーバーレスでは
// インスタンスごとに別で、入れ替わると消える。消えても毎回署名する
// 従来の動作に戻るだけで、表示や権限には影響しない。
// ============================================================

/** 署名付きURLの有効期限（秒） */
export const SIGNED_URL_EXPIRES_IN_SECONDS = 60 * 60; // 1時間

/**
 * 同じURLを再利用する時間（ミリ秒）。返すURLには常に
 * 「有効期限 − 再利用時間」（45分）以上の残り時間がある
 */
export const SIGNED_URL_REUSE_MS = 15 * 60 * 1000; // 15分

/** キャッシュの上限件数。超えたら最も長く使われていないものから捨てる */
export const SIGNED_URL_CACHE_MAX_ENTRIES = 2000;

export type SignedUrlScope =
  | { kind: "private"; userId: string }
  | { kind: "public" };

/** 渡したパスに署名し、成功したものだけを path → URL で返す */
export type SignPaths = (paths: string[]) => Promise<Map<string, string>>;

type CacheEntry = {
  url: string;
  path: string;
  scopeKind: SignedUrlScope["kind"];
  issuedAt: number;
};

export type SignedUrlCacheStats = {
  hits: number;
  misses: number;
  /** privateで本人のフォルダ以外のパスが渡され、署名しなかった件数 */
  rejected: number;
  size: number;
};

type CacheState = {
  entries: Map<string, CacheEntry>;
  stats: Omit<SignedUrlCacheStats, "size">;
};

// 開発時のHMRやルートごとのバンドルでモジュールが複数回読み込まれても、
// 同じプロセスでは1つのキャッシュを共有する
const STATE_KEY = Symbol.for("recloset.signedImageUrlCache");

function getState(): CacheState {
  const holder = globalThis as typeof globalThis & {
    [STATE_KEY]?: CacheState;
  };
  holder[STATE_KEY] ??= {
    entries: new Map(),
    stats: { hits: 0, misses: 0, rejected: 0 },
  };
  return holder[STATE_KEY];
}

export function isPathAllowedForScope(
  path: string,
  scope: SignedUrlScope,
): boolean {
  if (scope.kind === "public") return path.length > 0;
  return scope.userId.length > 0 && path.startsWith(`${scope.userId}/`);
}

function toCacheKey(scope: SignedUrlScope, path: string): string {
  return scope.kind === "private"
    ? `private:${scope.userId}:${path}`
    : `public:${path}`;
}

function isDebugEnabled(): boolean {
  return process.env.SIGNED_IMAGE_URL_CACHE_DEBUG === "1";
}

/**
 * paths の署名付きURLを返す。再利用時間内のものはキャッシュから、
 * それ以外は sign でまとめて1回発行する。署名できなかったパスは含まない。
 *
 * paths は、呼び出し側がRLSを通したデータ取得で得たものだけを渡すこと。
 */
export async function resolveSignedUrls(
  paths: readonly string[],
  scope: SignedUrlScope,
  sign: SignPaths,
  label: string,
): Promise<Map<string, string>> {
  const state = getState();
  const result = new Map<string, string>();
  const missing: string[] = [];
  let hits = 0;
  let rejected = 0;
  const now = Date.now();

  for (const path of new Set(paths)) {
    if (!isPathAllowedForScope(path, scope)) {
      rejected += 1;
      continue;
    }
    const key = toCacheKey(scope, path);
    const entry = state.entries.get(key);
    if (entry && now >= entry.issuedAt && now - entry.issuedAt < SIGNED_URL_REUSE_MS) {
      // 最近使ったものとして末尾へ移す（上限超過時は先頭から捨てる）
      state.entries.delete(key);
      state.entries.set(key, entry);
      result.set(path, entry.url);
      hits += 1;
    } else {
      if (entry) state.entries.delete(key);
      missing.push(path);
    }
  }

  if (missing.length > 0) {
    let signed = new Map<string, string>();
    try {
      signed = await sign(missing);
    } catch (error) {
      console.error(`${label} signed url error:`, error);
    }
    for (const path of missing) {
      const url = signed.get(path);
      if (!url) continue;
      result.set(path, url);
      // 署名の依頼前の時刻を発行時刻とする（実際の残り時間は計算より長くなる側）
      state.entries.set(toCacheKey(scope, path), {
        url,
        path,
        scopeKind: scope.kind,
        issuedAt: now,
      });
    }
    while (state.entries.size > SIGNED_URL_CACHE_MAX_ENTRIES) {
      const oldestKey = state.entries.keys().next().value;
      if (oldestKey === undefined) break;
      state.entries.delete(oldestKey);
    }
  }

  state.stats.hits += hits;
  state.stats.misses += missing.length;
  state.stats.rejected += rejected;

  if (rejected > 0) {
    console.warn(
      `${label}: ${rejected} image path(s) outside the user's folder were not signed`,
    );
  }
  if (isDebugEnabled()) {
    const { hits: totalHits, misses: totalMisses } = state.stats;
    const total = totalHits + totalMisses;
    const rate = total > 0 ? Math.round((totalHits / total) * 100) : 0;
    console.info(
      `[signed-image-url-cache] ${label} (${scope.kind}) hit=${hits} miss=${missing.length} rejected=${rejected} | process total hit=${totalHits} miss=${totalMisses} rate=${rate}% size=${state.entries.size}`,
    );
  }

  return result;
}

/** 指定したパスのURLを両方のスコープから捨てる（削除時。同じプロセス内のみ） */
export function forgetSignedUrls(paths: readonly string[]): void {
  if (paths.length === 0) return;
  const targets = new Set(paths);
  const { entries } = getState();
  for (const [key, entry] of entries) {
    if (targets.has(entry.path)) entries.delete(key);
  }
}

/** 公開用のURLをすべて捨てる（公開解除時。同じプロセス内のみ） */
export function forgetPublicSignedUrls(): void {
  const { entries } = getState();
  for (const [key, entry] of entries) {
    if (entry.scopeKind === "public") entries.delete(key);
  }
}

export function getSignedUrlCacheStats(): SignedUrlCacheStats {
  const state = getState();
  return { ...state.stats, size: state.entries.size };
}

/** テスト用: キャッシュと集計を空にする */
export function resetSignedUrlCache(): void {
  const state = getState();
  state.entries.clear();
  state.stats = { hits: 0, misses: 0, rejected: 0 };
}
