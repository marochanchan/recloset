"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useState } from "react";

// 下書きの保存・写真だけ登録の後にCloset一覧へ移動したときに、一度だけ出すお知らせ。
// URLのクエリを使うと絞り込みのリンク等に引き継がれて繰り返し出るため、
// sessionStorageの一度きりの印で渡す（表示したらすぐ消すので、
// 再読み込みや「戻る」では出ない）。保存できない環境では出さないだけ。

const STORAGE_KEY = "recloset:draft-saved-notice";

type ClosetNoticeKind = "draft-saved" | "photo-registered";

function rememberClosetNotice(kind: ClosetNoticeKind) {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, kind);
  } catch {
    // 保存できなくても、保存・登録・画面の移動はそのまま続ける
  }
}

/** 下書きの保存に成功した直後、画面を移動する前に呼ぶ */
export function rememberDraftSavedNotice() {
  rememberClosetNotice("draft-saved");
}

/** 写真だけ登録に成功した直後、画面を移動する前に呼ぶ */
export function rememberPhotoRegisteredNotice() {
  rememberClosetNotice("photo-registered");
}

function consumeClosetNotice(): ClosetNoticeKind | null {
  try {
    const value = window.sessionStorage.getItem(STORAGE_KEY);
    if (value !== "draft-saved" && value !== "photo-registered") return null;
    window.sessionStorage.removeItem(STORAGE_KEY);
    return value;
  } catch {
    return null;
  }
}

export function ClosetNotice() {
  const [kind, setKind] = useState<ClosetNoticeKind | null>(null);

  useEffect(() => {
    const consumed = consumeClosetNotice();
    if (consumed) setKind(consumed);
  }, []);

  // cacheComponents の <Activity> でCloset一覧が残ったまま再表示されても
  // 出し直さないよう、隠れるときに消す
  useLayoutEffect(() => {
    return () => setKind(null);
  }, []);

  if (!kind) return null;

  return (
    <p
      role="status"
      className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground"
    >
      {kind === "draft-saved" ? (
        <span>下書きを保存しました</span>
      ) : (
        <>
          <span>クローゼットに登録しました</span>
          <Link
            href="/protected/items/new?mode=photo"
            className="underline underline-offset-4 hover:text-foreground"
          >
            続けて写真だけ登録 →
          </Link>
        </>
      )}
    </p>
  );
}
