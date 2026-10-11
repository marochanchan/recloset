"use client";

import { useEffect, useLayoutEffect, useState } from "react";

// 下書きを保存してCloset一覧へ移動したときに、一度だけ出すお知らせ。
// URLのクエリを使うと絞り込みのリンク等に引き継がれて繰り返し出るため、
// sessionStorageの一度きりの印で渡す（表示したらすぐ消すので、
// 再読み込みや「戻る」では出ない）。保存できない環境では出さないだけ。

const STORAGE_KEY = "recloset:draft-saved-notice";

/** 保存に成功した直後、画面を移動する前に呼ぶ */
export function rememberDraftSavedNotice() {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, "1");
  } catch {
    // 保存できなくても、下書きの保存・画面の移動はそのまま続ける
  }
}

function consumeDraftSavedNotice(): boolean {
  try {
    if (window.sessionStorage.getItem(STORAGE_KEY) !== "1") return false;
    window.sessionStorage.removeItem(STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

export function DraftSavedNotice() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (consumeDraftSavedNotice()) setVisible(true);
  }, []);

  // cacheComponents の <Activity> でCloset一覧が残ったまま再表示されても
  // 出し直さないよう、隠れるときに消す
  useLayoutEffect(() => {
    return () => setVisible(false);
  }, []);

  if (!visible) return null;

  return (
    <p
      role="status"
      className="rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground"
    >
      下書きを保存しました
    </p>
  );
}
