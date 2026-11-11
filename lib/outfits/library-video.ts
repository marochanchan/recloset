// 端末から選んだ動画を受け入れてよいかの判定と、その結果の言葉、送るときのファイル名（純粋な関数）。
// 長さは <video> の loadedmetadata で調べた値をここに渡す（調べる部分はブラウザ専用の library-video-browser）。

// Stream の直接アップロードの長さの上限（maxDurationSeconds: 60 と同じ）
export const LIBRARY_VIDEO_MAX_SECONDS = 60;
// Direct Creator Upload の基本の POST の上限（200MB）。境界の解釈が分かれないよう、小さいほう（10進）に合わせる
export const LIBRARY_VIDEO_MAX_BYTES = 200 * 1000 * 1000;

export type LibraryVideoRejection = "too_large" | "too_long" | "unreadable";
export type LibraryVideoVerdict = { ok: true } | { ok: false; reason: LibraryVideoRejection };

export const LIBRARY_VIDEO_MESSAGES: Record<LibraryVideoRejection, string> = {
  too_large: "200MB までの動画を選んでください",
  too_long: "60秒までの動画を選んでください",
  unreadable: "この動画は開けませんでした。別の動画を選んでください",
};

// 大きさ → 読めるか → 長さ の順に見る。
// 長さが分からない（NaN・Infinity・0 以下）ものは、60秒以内と確かめられないので「開けない」として扱う
export function judgeLibraryVideo(input: { sizeBytes: number; durationSec: number }): LibraryVideoVerdict {
  if (input.sizeBytes > LIBRARY_VIDEO_MAX_BYTES) return { ok: false, reason: "too_large" };
  if (!Number.isFinite(input.durationSec) || input.durationSec <= 0) {
    return { ok: false, reason: "unreadable" };
  }
  if (input.durationSec > LIBRARY_VIDEO_MAX_SECONDS) return { ok: false, reason: "too_long" };
  return { ok: true };
}

// 送るときのファイル名。iPhone の動画は video/quicktime（.mov）。種類が空なら元の名前の拡張子を見る
export function libraryVideoUploadName(input: { type: string; name?: string }): string {
  const type = input.type.toLowerCase();
  const ext = (input.name ?? "").toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  if (type.includes("quicktime") || ext === "mov") return "outfit.mov";
  if (type.includes("mp4") || ext === "mp4" || ext === "m4v") return "outfit.mp4";
  if (type.includes("webm") || ext === "webm") return "outfit.webm";
  return "outfit.mp4";
}
