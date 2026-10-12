"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

// active の間、画面を離れる操作の前に確認する。
// - 再読み込み・タブを閉じる: ブラウザ標準の確認（beforeunload）
// - アプリ内のリンク（ヘッダー・ボトムナビなど）: Next.jsのLinkより先にキャプチャ段階で
//   受け取って移動を止め、LeaveConfirmDialog を出す
// 判定は use-clothing-draft.ts の離脱確認と同じ（別タブ・修飾キー付き・同じURLは止めない）
export function useLeaveGuard(active: boolean) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const allowedRef = useRef(false);
  const pendingRef = useRef<{ anchor: HTMLAnchorElement; href: string } | null>(null);

  useEffect(() => {
    if (!active) return;

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (allowedRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    };

    const handleLinkClick = (event: MouseEvent) => {
      if (allowedRef.current || event.defaultPrevented) return;
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }
      const anchor = (event.target as Element | null)?.closest?.("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if (anchor.target === "_blank" || anchor.hasAttribute("download")) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      pendingRef.current = { anchor, href: `${url.pathname}${url.search}${url.hash}` };
      setIsOpen(true);
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    document.addEventListener("click", handleLinkClick, true);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      document.removeEventListener("click", handleLinkClick, true);
    };
  }, [active]);

  return {
    /** これ以降は確認せずに移動する（登録が完了して画面を移動するときに呼ぶ） */
    allowLeave: () => {
      allowedRef.current = true;
    },
    dialog: {
      open: isOpen,
      onCancel: () => {
        pendingRef.current = null;
        setIsOpen(false);
      },
      onConfirm: () => {
        const pending = pendingRef.current;
        pendingRef.current = null;
        setIsOpen(false);
        if (!pending) return;
        allowedRef.current = true;
        if (pending.anchor.isConnected) {
          pending.anchor.click();
        } else {
          router.push(pending.href);
        }
      },
    },
  };
}
