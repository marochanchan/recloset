// 選んだ動画ファイルの長さを調べる（ブラウザ専用）。再生できない形式は reject する。
// 向きは見ない：iPhone の動画は回転の情報を持つが、ブラウザは <video> の表示も canvas への描画も
// 回転後の向きで返す（videoWidth/Height も回転後）。だから回転の値は 0 のまま渡す。

const PROBE_TIMEOUT_MS = 10_000;

export function probeVideoFile(file: Blob): Promise<{ durationSec: number }> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    const url = URL.createObjectURL(file);
    let settled = false;
    const finish = (error: Error | null, durationSec = 0) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      video.removeAttribute("src");
      video.load();
      URL.revokeObjectURL(url);
      if (error) reject(error);
      else resolve({ durationSec });
    };
    const timer = setTimeout(() => finish(new Error("probe timeout")), PROBE_TIMEOUT_MS);

    video.preload = "metadata";
    video.muted = true;
    video.onerror = () => finish(new Error("video cannot be opened"));
    video.onloadedmetadata = () => {
      // 音声だけ・絵が無いものは動画として扱わない
      if (video.videoWidth <= 0 || video.videoHeight <= 0) return finish(new Error("no video track"));
      if (Number.isFinite(video.duration)) return finish(null, video.duration);
      // 長さが無限と出る形式（webm など）は、端まで飛ばして確定させる。分からなければ 0 を返す（判定側で「開けない」）
      video.ontimeupdate = () => finish(null, Number.isFinite(video.duration) ? video.duration : 0);
      video.currentTime = 1e101;
    };
    video.src = url;
  });
}
