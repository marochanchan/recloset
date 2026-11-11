// 動画の変換待ちで、画面を何回まで自動で読み直すかの判断（純粋な関数）。

// 読み直す間隔（ミリ秒）
export const VIDEO_POLL_INTERVAL_MS = 5000;
// 最長3分（5秒 × 36回）で止める
export const VIDEO_POLL_MAX_ATTEMPTS = 36;

// これまでに読み直した回数から、次の1回をするか・この1回で打ち止めか
export function nextVideoPoll(attempts: number): { refresh: boolean; attempts: number; exhausted: boolean } {
  if (!Number.isInteger(attempts) || attempts < 0 || attempts >= VIDEO_POLL_MAX_ATTEMPTS) {
    return { refresh: false, attempts: Math.max(0, VIDEO_POLL_MAX_ATTEMPTS), exhausted: true };
  }
  const next = attempts + 1;
  return { refresh: true, attempts: next, exhausted: next >= VIDEO_POLL_MAX_ATTEMPTS };
}
