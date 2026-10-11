"use client";

import {
  CLOTHING_IMAGE_BUCKET,
  deleteClothingDraft,
  saveClothingDraft,
  type DraftFields,
} from "@/lib/clothing-drafts";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

// ============================================================
// 服登録フォームの下書き（保存・再開・登録完了後の片付け・離脱確認）。
// - 保存は手動（「下書きとして保存」）。自動保存はしない
// - 未保存の変更があるときだけ、ページの再読み込み・タブを閉じる操作
//   （ブラウザ標準の警告）と、アプリ内のリンクの移動（ページ内の確認ダイアログ）
//   で確認を出す
//   （ブラウザの「戻る」ボタンは対象外。App Routerに遷移を止める仕組みがないため）
// ============================================================

/** 再開する下書き（サーバーで本人の下書きであることを確認済み） */
export type ClothingDraftToResume = {
  id: string;
  fields: DraftFields;
  imagePaths: string[];
};

/** 下書きの保存対象になる画像（フォームの並び順） */
export type DraftImageState = {
  key: string;
  processed: Blob | null;
  isProcessing: boolean;
  draftPath: string | null;
};

// 変更の有無の判定用（値と、写真の並び・保存状態）
function toSnapshot(fields: DraftFields, imageIds: string[]): string {
  return JSON.stringify({ fields, imageIds });
}

function imageIdsOf(images: DraftImageState[]): string[] {
  return images.map((image) => image.draftPath ?? `new:${image.key}`);
}

export function useClothingDraft({
  enabled,
  initialDraft,
  initialFields,
  fields,
  images,
  addDraftImages,
  setDraftPaths,
}: {
  /** 新規登録のときだけtrue（編集では下書きを使わない） */
  enabled: boolean;
  initialDraft: ClothingDraftToResume | null;
  /** フォームの初期値（変更の有無の基準） */
  initialFields: DraftFields;
  /** 今のフォームの値 */
  fields: DraftFields;
  images: DraftImageState[];
  addDraftImages: (entries: { path: string; blob: Blob }[]) => void;
  setDraftPaths: (pathByKey: Record<string, string>) => void;
}) {
  const [draftId, setDraftId] = useState<string | null>(
    initialDraft?.id ?? null,
  );
  const [savedPaths, setSavedPaths] = useState<string[]>(
    initialDraft?.imagePaths ?? [],
  );
  const [baseline, setBaseline] = useState(() =>
    toSnapshot(initialFields, initialDraft?.imagePaths ?? []),
  );
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">(
    initialDraft && initialDraft.imagePaths.length > 0 ? "loading" : "ready",
  );
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [draftMessage, setDraftMessage] = useState<{
    tone: "success" | "error";
    text: string;
  } | null>(null);
  const leaveAllowedRef = useRef(false);
  // 離脱の確認中に押されたリンク（「保存せず移動」でそのリンクをもう一度押す）
  const pendingLeaveRef = useRef<{ anchor: HTMLAnchorElement; href: string } | null>(
    null,
  );
  const [isLeaveConfirmOpen, setIsLeaveConfirmOpen] = useState(false);
  const router = useRouter();
  // 二重保存の防止。stateは次の描画まで反映されないため、連続クリックを
  // 同期的に止めるrefを併用する（保存に成功したら、画面を離れるまで戻さない）
  const savingRef = useRef(false);

  // 保存に成功して画面を移動した後、ブラウザの「戻る」でこのフォームが
  // 再表示されたとき（cacheComponents の <Activity> で状態が残る）に、
  // ボタンが「保存中」のまま押せなくならないよう、隠れるときに戻す
  useLayoutEffect(() => {
    return () => {
      savingRef.current = false;
      setIsSavingDraft(false);
      leaveAllowedRef.current = false;
      pendingLeaveRef.current = null;
      setIsLeaveConfirmOpen(false);
    };
  }, []);

  // 再開: 下書きの写真をStorageから読み込み、新しく選んだ画像として並べる。
  // 1枚でも読み込めなければ、保存・登録を止める（読み込めなかった写真を
  // 「削除された」と扱って消してしまわないため）
  const loadStartedRef = useRef(false);
  useEffect(() => {
    if (!initialDraft || initialDraft.imagePaths.length === 0) return;
    if (loadStartedRef.current) return;
    loadStartedRef.current = true;

    const supabase = createClient();
    void (async () => {
      const entries: { path: string; blob: Blob }[] = [];
      let failed = false;
      for (const path of initialDraft.imagePaths) {
        const { data, error } = await supabase.storage
          .from(CLOTHING_IMAGE_BUCKET)
          .download(path);
        if (error || !data) {
          console.error("draft image download failed:", error);
          failed = true;
          continue;
        }
        entries.push({ path, blob: data });
      }
      addDraftImages(entries);
      setLoadState(failed ? "error" : "ready");
    })();
    // 初回だけ読み込む
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isDirty =
    enabled &&
    loadState === "ready" &&
    toSnapshot(fields, imageIdsOf(images)) !== baseline;

  // 未保存の変更があるときだけ、離脱の確認を出す
  useEffect(() => {
    if (!isDirty) return;

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (leaveAllowedRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    };

    // アプリ内のリンク（ヘッダー・ボトムナビなど）。Next.jsのLinkより先に
    // キャプチャ段階で受け取って移動を止め、確認ダイアログを出す
    const handleLinkClick = (event: MouseEvent) => {
      if (leaveAllowedRef.current || event.defaultPrevented) return;
      if (
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }
      const anchor = (event.target as Element | null)?.closest?.("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) return;
      if (anchor.target === "_blank" || anchor.hasAttribute("download")) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (
        url.pathname === window.location.pathname &&
        url.search === window.location.search
      ) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      pendingLeaveRef.current = {
        anchor,
        href: `${url.pathname}${url.search}${url.hash}`,
      };
      setIsLeaveConfirmOpen(true);
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    document.addEventListener("click", handleLinkClick, true);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      document.removeEventListener("click", handleLinkClick, true);
    };
  }, [isDirty]);

  /**
   * 下書きを保存する。成功したら true（呼び出し元で画面を移動する）、
   * 失敗・保存できない状態なら false（入力値と写真はそのまま残る）。
   */
  const saveDraft = async (): Promise<boolean> => {
    if (!enabled || savingRef.current || loadState !== "ready") return false;
    if (images.some((image) => image.isProcessing || !image.processed)) {
      setDraftMessage({
        tone: "error",
        text: "画像を準備しています。少し待ってから保存してください",
      });
      return false;
    }

    savingRef.current = true;
    setIsSavingDraft(true);
    setDraftMessage(null);
    try {
      const supabase = createClient();
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();
      if (userError || !user) {
        throw new Error("ログイン情報が確認できませんでした");
      }

      const savedFields = fields;
      const result = await saveClothingDraft({
        supabase,
        userId: user.id,
        draftId,
        fields: savedFields,
        images: images.map((image) => ({
          key: image.key,
          draftPath: image.draftPath,
          blob: image.processed as Blob,
        })),
        previousPaths: savedPaths,
      });

      setDraftId(result.draftId);
      setSavedPaths(result.imagePaths);
      setDraftPaths(result.pathByKey);
      setBaseline(toSnapshot(savedFields, result.imagePaths));
      // 再読み込み・共有しても同じ下書きを開けるよう、URLだけを更新する
      // （ページは再読み込みしない）
      window.history.replaceState(
        null,
        "",
        `/protected/items/new?draft=${result.draftId}`,
      );
      // この後は画面を移動するため、離脱確認を出さず、ボタンも押せないままにする
      leaveAllowedRef.current = true;
      return true;
    } catch (error) {
      console.error("draft save failed:", error);
      setDraftMessage({
        tone: "error",
        text: "下書きを保存できませんでした。前回保存した下書きはそのまま残っています。もう一度お試しください",
      });
      savingRef.current = false;
      setIsSavingDraft(false);
      return false;
    }
  };

  /**
   * 服の登録が完了した後に下書きを削除する。下書きがなければ何もしない。
   * 失敗しても登録済みの服には触れない（false を返し、画面で伝える）。
   */
  const completeDraft = async (): Promise<boolean> => {
    if (!draftId) return true;
    const ok = await deleteClothingDraft({
      supabase: createClient(),
      draftId,
    });
    if (ok) {
      setDraftId(null);
      setSavedPaths([]);
    }
    return ok;
  };

  return {
    draftId,
    isDirty,
    isSavingDraft,
    isLoadingDraft: loadState === "loading",
    draftLoadFailed: loadState === "error",
    draftMessage,
    saveDraft,
    completeDraft,
    /** 離脱の確認ダイアログ（LeaveConfirmDialog に渡す） */
    leaveConfirm: {
      open: isLeaveConfirmOpen,
      /** 「編集を続ける」: 移動せず、入力値・写真はそのまま */
      onCancel: () => {
        pendingLeaveRef.current = null;
        setIsLeaveConfirmOpen(false);
      },
      /** 「保存せず移動」: 押されたリンクで移動する（下書きは保存しない） */
      onConfirm: () => {
        const pending = pendingLeaveRef.current;
        pendingLeaveRef.current = null;
        setIsLeaveConfirmOpen(false);
        if (!pending) return;
        leaveAllowedRef.current = true;
        // 同じリンクを押し直すと、Linkの指定（replace・scroll など）がそのまま効く。
        // リンクが画面から消えていたら、URLで移動する
        if (pending.anchor.isConnected) {
          pending.anchor.click();
        } else {
          router.push(pending.href);
        }
      },
    },
    /** 登録完了後の画面遷移など、確認なしで離れてよい状態にする */
    allowLeave: () => {
      leaveAllowedRef.current = true;
    },
  };
}
