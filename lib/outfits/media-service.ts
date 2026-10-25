import type { AssetState, MediaStore } from "@/lib/media/media-store";
import type { OutfitMediaDb, OutfitMediaRow } from "@/lib/outfits/media-db";

// 着画のアップロード（開始・完了・送り直し）。Cloudflare の ID はサーバーで作り、クライアントからは受け取らない。

// アップロード URL の期限
const UPLOAD_TTL_MS = 30 * 60 * 1000;

export type MediaServiceDeps = { db: OutfitMediaDb; store: MediaStore; now: () => Date };

// 同時の開始・送り直し、別のコーデのメディア ID の使い回しなど、今は進められないとき
export class MediaUploadConflictError extends Error {
  constructor(message = "media_conflict") {
    super(message);
    this.name = "MediaUploadConflictError";
  }
}

// 実体がまだ届いていないとき
export class MediaNotUploadedError extends Error {
  constructor(message = "media_not_uploaded") {
    super(message);
    this.name = "MediaNotUploadedError";
  }
}

// 本人のメディアが見つからないとき（他人の ID も同じ扱い）
export class MediaNotFoundError extends Error {
  constructor(message = "media_not_found") {
    super(message);
    this.name = "MediaNotFoundError";
  }
}

// 消せなくても本筋は止めない（残った ID は期限で消える）
async function deleteQuietly(store: MediaStore, row: { provider: OutfitMediaRow["provider"] }, assetId: string) {
  try {
    await store.deleteAsset(row.provider, assetId);
  } catch {
    // 無視する
  }
}

// 実体の状態から、メディアに入れる状態を決める。まだ届いていなければ null
function targetStatus(kind: OutfitMediaRow["kind"], state: AssetState["state"]): "processing" | "ready" | null {
  if (state === "ready") return "ready";
  if (state === "processing" && kind === "video") return "processing";
  return null;
}

function dimensions(state: AssetState, width?: number, height?: number) {
  const out: { width?: number; height?: number; durationSec?: number } = {};
  const w = width ?? state.width;
  const h = height ?? state.height;
  if (w !== undefined) out.width = w;
  if (h !== undefined) out.height = h;
  if (state.durationSec !== undefined) out.durationSec = state.durationSec;
  return out;
}

export async function startMediaUpload(
  deps: MediaServiceDeps,
  input: {
    userId: string;
    mediaId: string;
    outfitId: string;
    kind: "photo" | "video";
    takenAt: Date | null;
    sortOrder: number;
  },
): Promise<{ mediaId: string; uploadUrl: string | null }> {
  const existing = await deps.db.getMedia(input.userId, input.mediaId);
  if (existing) {
    if (existing.outfitId !== input.outfitId || existing.kind !== input.kind) {
      throw new MediaUploadConflictError("media_conflict");
    }
    const result = await retryMediaUpload(deps, { userId: input.userId, mediaId: input.mediaId });
    return { mediaId: input.mediaId, uploadUrl: result.uploadUrl };
  }

  const expiresAt = new Date(deps.now().getTime() + UPLOAD_TTL_MS);
  const upload = await deps.store.createUpload({
    kind: input.kind,
    userId: input.userId,
    mediaId: input.mediaId,
    expiresAt,
  });

  let row: OutfitMediaRow;
  try {
    row = await deps.db.registerMedia({
      userId: input.userId,
      mediaId: input.mediaId,
      outfitId: input.outfitId,
      kind: input.kind,
      provider: upload.provider,
      assetId: upload.assetId,
      uploadExpiresAt: expiresAt,
      takenAt: input.takenAt,
      sortOrder: input.sortOrder,
    });
  } catch (error) {
    // DB に保存できていて応答だけ失われた場合も、ブラウザは URL を受け取っていないので消してよい
    await deleteQuietly(deps.store, upload, upload.assetId);
    throw error;
  }

  if (row.providerAssetId !== upload.assetId) {
    // 同時の開始で、もう一方が先に登録した。登録されていない ID へは送らせない
    await deleteQuietly(deps.store, upload, upload.assetId);
    throw new MediaUploadConflictError("media_conflict");
  }
  return { mediaId: input.mediaId, uploadUrl: upload.uploadUrl };
}

export async function completeMediaUpload(
  deps: MediaServiceDeps,
  input: { userId: string; mediaId: string; width?: number; height?: number },
): Promise<OutfitMediaRow> {
  const row = await deps.db.getMedia(input.userId, input.mediaId);
  if (!row) throw new MediaNotFoundError();

  const state = await deps.store.getAssetState(row.provider, row.providerAssetId);
  const status = targetStatus(row.kind, state.state) ?? (state.state === "failed" ? "failed" : null);
  if (!status) throw new MediaNotUploadedError();

  // 確かめた試行を渡す。置き換わっていれば MediaUploadConflictError になる
  return deps.db.setState({
    userId: input.userId,
    mediaId: input.mediaId,
    expectedUploadAttempt: row.uploadAttempt,
    status,
    ...dimensions(state, input.width, input.height),
  });
}

export async function retryMediaUpload(
  deps: MediaServiceDeps,
  input: { userId: string; mediaId: string },
): Promise<{ mediaId: string; uploadUrl: string | null; row: OutfitMediaRow }> {
  const row = await deps.db.getMedia(input.userId, input.mediaId);
  if (!row) throw new MediaNotFoundError();
  if (row.kind === "frame") throw new MediaUploadConflictError("media_conflict");

  const state = await deps.store.getAssetState(row.provider, row.providerAssetId);
  const status = targetStatus(row.kind, state.state);
  if (status) {
    // もう届いている。新しい試行は作らない
    const updated = await deps.db.setState({
      userId: input.userId,
      mediaId: input.mediaId,
      expectedUploadAttempt: row.uploadAttempt,
      status,
      ...dimensions(state),
    });
    return { mediaId: input.mediaId, uploadUrl: null, row: updated };
  }

  // アップロード URL はサーバーに残していないので、期限内でも新しく作る
  const expiresAt = new Date(deps.now().getTime() + UPLOAD_TTL_MS);
  const upload = await deps.store.createUpload({
    kind: row.kind,
    userId: input.userId,
    mediaId: input.mediaId,
    expiresAt,
  });

  let replaced: OutfitMediaRow;
  try {
    replaced = await deps.db.replaceAsset({
      userId: input.userId,
      mediaId: input.mediaId,
      expectedUploadAttempt: row.uploadAttempt,
      assetId: upload.assetId,
      uploadExpiresAt: expiresAt,
    });
  } catch (error) {
    if (error instanceof MediaUploadConflictError) {
      await deleteQuietly(deps.store, upload, upload.assetId);
    }
    throw error;
  }

  if (replaced.providerAssetId !== upload.assetId) {
    await deleteQuietly(deps.store, upload, upload.assetId);
    if (replaced.status === "processing" || replaced.status === "ready") {
      // 確かめたあとに、完了の知らせが先に届いていた
      return { mediaId: input.mediaId, uploadUrl: null, row: replaced };
    }
    throw new MediaUploadConflictError("media_attempt_changed");
  }
  return { mediaId: input.mediaId, uploadUrl: upload.uploadUrl, row: replaced };
}
