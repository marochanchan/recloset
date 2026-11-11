// 確定前のコーデに、2枚目以降の写真と動画を足す（addOutfitMediaUpload の中身）。
// 本人であること・下書きであることの確認は、Cloudflare に触る前に済ませる。
import { startMediaUpload, type MediaServiceDeps } from "@/lib/outfits/media-service";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// 0 番は下書きを作る最初の写真（startOutfitPhotoUpload）。6枚の写真のあとに動画が来るので 6 まで
const MIN_SORT_ORDER = 1;
const MAX_SORT_ORDER = 6;

export type AddMediaInput = {
  outfitId: string;
  mediaId: string;
  kind: "photo" | "video";
  sortOrder: number;
};

export function parseAddMediaInput(
  input: unknown,
): { ok: true; value: AddMediaInput } | { ok: false } {
  if (typeof input !== "object" || input === null) return { ok: false };
  const v = input as Record<string, unknown>;
  if (
    typeof v.outfitId !== "string" ||
    !UUID_PATTERN.test(v.outfitId) ||
    typeof v.mediaId !== "string" ||
    !UUID_PATTERN.test(v.mediaId) ||
    (v.kind !== "photo" && v.kind !== "video") ||
    typeof v.sortOrder !== "number" ||
    !Number.isInteger(v.sortOrder) ||
    v.sortOrder < MIN_SORT_ORDER ||
    v.sortOrder > MAX_SORT_ORDER
  ) {
    return { ok: false };
  }
  return {
    ok: true,
    value: { outfitId: v.outfitId, mediaId: v.mediaId, kind: v.kind, sortOrder: v.sortOrder },
  };
}

// 自分の下書き（未確定）ではないとき
export class OutfitNotDraftError extends Error {
  constructor(message = "outfit_not_draft") {
    super(message);
    this.name = "OutfitNotDraftError";
  }
}

export async function addMediaToDraft(
  deps: MediaServiceDeps,
  input: AddMediaInput & {
    userId: string;
    // 呼んだ本人の、未確定のコーデか（RLS 付きの本人のクライアントで見る）
    isOwnDraft: (outfitId: string) => Promise<boolean>;
  },
): Promise<{ mediaId: string; uploadUrl: string | null }> {
  if (!(await input.isOwnDraft(input.outfitId))) throw new OutfitNotDraftError();
  // 同じ mediaId が既にあれば startMediaUpload が送り直しに回す（冪等）。
  // register_outfit_media も outfit の持ち主を確かめる（二重の確認）
  const result = await startMediaUpload(deps, {
    userId: input.userId,
    mediaId: input.mediaId,
    outfitId: input.outfitId,
    kind: input.kind,
    takenAt: null,
    sortOrder: input.sortOrder,
  });

  // 最初の確認と登録のあいだに、別の画面で確定されたかもしれない（RPC は下書きかどうかを見ない）。
  // 登録のあとにもう一度確かめ、確定済みなら今作った実体を消して断る。
  // 完全な直し方は、確定と同じロックの下で RPC が pending を確かめること（migration で、あとで行う）
  if (result.uploadUrl !== null && !(await input.isOwnDraft(input.outfitId))) {
    try {
      const row = await deps.db.getMedia(input.userId, input.mediaId);
      if (row) {
        await deps.store.deleteAsset(row.provider, row.providerAssetId);
        // 行は残るが、届かない実体のまま「失敗」にして画面には出さない（uploading からは failed にできる）
        await deps.db.setState({
          userId: input.userId,
          mediaId: input.mediaId,
          expectedUploadAttempt: row.uploadAttempt,
          status: "failed",
        });
      }
    } catch {
      // 後始末の失敗で、断るという結果は変えない
    }
    throw new OutfitNotDraftError();
  }
  return result;
}

// 完了の知らせの寸法の確認。写真は必須（1〜20000 の整数）、動画は 2つとも省くか 2つとも正しく指定
export function isValidCompleteSize(kind: "photo" | "video" | "frame", width: unknown, height: unknown): boolean {
  if (width === undefined && height === undefined) return kind === "video";
  const ok = (v: unknown) => typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 20000;
  return ok(width) && ok(height);
}
