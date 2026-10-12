// ============================================================
// URLの # で指定した要素へ、後から表示された時点でスクロールするための判定
// （純粋関数。テスト: node --test scripts/test-weekly-celebration.mts）
//
// ページ内の一部をSuspenseで後から表示する場合、遷移した時点では要素がなく、
// ブラウザ・Next.jsの # へのスクロールが効かない。表示されたときに
// 自分で判定してスクロールする（components/scroll-to-hash-target.tsx）
// ============================================================

/** location.hash（例: "#review-suggestions-title"）が id を指しているか */
export function isHashTarget(hash: string, id: string): boolean {
  if (!hash.startsWith("#") || !id) return false;
  let decoded: string;
  try {
    decoded = decodeURIComponent(hash.slice(1));
  } catch {
    return false;
  }
  return decoded === id;
}

/** 視差効果を減らす設定（prefers-reduced-motion: reduce）では、なめらかに動かさず一度で移動する */
export function getHashScrollBehavior(prefersReducedMotion: boolean): ScrollBehavior {
  return prefersReducedMotion ? "auto" : "smooth";
}
