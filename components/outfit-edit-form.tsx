"use client";

import { confirmOutfitAction } from "@/app/(main)/protected/looks/actions";
import { OutfitItemPicker, type PickerItem } from "@/components/outfit-item-picker";
import { Button } from "@/components/ui/button";
import { diffItemIds } from "@/lib/outfits/looks";
import { useRouter } from "next/navigation";
import { useLayoutEffect, useRef, useState } from "react";

type OutfitEditFormProps = {
  outfitId: string;
  /** 開いた時点の版。古いとサーバーが拒否する */
  revision: number;
  wornOn: string;
  note: string | null;
  items: PickerItem[];
  initialItemIds: string[];
};

const STALE_MESSAGE = "ほかの画面で変わりました。開き直してください";
const FAILED_MESSAGE = "うまく進められませんでした。時間をおいて、もう一度お試しください";

// 確定済みの着画の「着た服」だけを直す。日付とメモは今の値のまま送る
export function OutfitEditForm({
  outfitId,
  revision,
  wornOn,
  note,
  items,
  initialItemIds,
}: OutfitEditFormProps) {
  const router = useRouter();
  const [selectedIds, setSelectedIds] = useState<string[]>(initialItemIds);
  const [message, setMessage] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const savingRef = useRef(false);
  // 最初の服の一覧。page 側の key（版と服の組み合わせ）が変わると作り直されるので、この間は変わらない
  const initialRef = useRef(initialItemIds);

  // Activity で画面が隠れたとき（詳細へ戻ったとき）に入力を最初の状態へ戻す。
  // 戻ってきたときに「保存しています」や前の選択が残らないようにする（版が変われば page の key で作り直される）
  // 保存中のロックは、その保存の finally が解除する（ここでは触らない）
  useLayoutEffect(
    () => () => {
      setMessage(null);
      setSelectedIds(initialRef.current);
    },
    [],
  );

  // 今の一覧にある服だけ
  const validIds = selectedIds.filter((id) => items.some((item) => item.id === id));
  const { changed } = diffItemIds(initialRef.current, validIds);
  const canSave = validIds.length > 0 && !isSaving;
  const detailHref = `/protected/looks/${outfitId}`;

  const handleSave = async () => {
    if (savingRef.current || validIds.length === 0) return;
    savingRef.current = true;
    setIsSaving(true);
    setMessage(null);
    try {
      const result = await confirmOutfitAction({
        outfitId,
        expectedRevision: revision,
        wornOn,
        itemIds: validIds,
        note,
      });
      if ("error" in result) {
        setMessage(result.error);
        return;
      }
      if (result.status === "stale") {
        setMessage(STALE_MESSAGE);
        return;
      }
      // confirmed / unchanged: 詳細へ戻る（confirmed は Server Action 側で詳細・服・一覧を再取得済み）
      router.push(detailHref);
    } catch {
      setMessage(FAILED_MESSAGE);
    } finally {
      // 成功でも必ず解除する（画面が Activity に残っても、開き直したとき固まらない）
      savingRef.current = false;
      setIsSaving(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <OutfitItemPicker
        items={items}
        selectedIds={validIds}
        onChange={setSelectedIds}
        disabled={isSaving}
      />

      {message && (
        <p role="alert" className="text-sm text-destructive">
          {message}
        </p>
      )}

      <Button type="button" onClick={handleSave} disabled={!canSave} className="w-full">
        {isSaving ? "保存しています" : changed ? "保存" : "このまま戻る"}
      </Button>
      {validIds.length === 0 && (
        <p className="text-xs text-muted-foreground">服を1つ以上選ぶと保存できます</p>
      )}
    </div>
  );
}
