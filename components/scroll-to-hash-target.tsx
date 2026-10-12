"use client";

import { getHashScrollBehavior, isHashTarget } from "@/lib/hash-scroll";
import { useEffect } from "react";

// Suspenseで後から表示される要素へ、URLの # で移動してきた場合にスクロールする。
// 対象の要素と一緒に表示される位置に置く（表示されたときに一度だけ判定する）。
// scrollTo で指定した要素（なければ id の要素）の先頭へ移動する
export function ScrollToHashTarget({
  targetId,
  scrollTo,
}: {
  /** URLの # と比べるid */
  targetId: string;
  /** 実際にスクロールする要素のid（省略時は targetId） */
  scrollTo?: string;
}) {
  useEffect(() => {
    if (!isHashTarget(window.location.hash, targetId)) return;
    const element =
      document.getElementById(scrollTo ?? targetId) ?? document.getElementById(targetId);
    if (!element) return;
    const prefersReducedMotion =
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    element.scrollIntoView({
      block: "start",
      behavior: getHashScrollBehavior(prefersReducedMotion),
    });
  }, [targetId, scrollTo]);

  return null;
}
