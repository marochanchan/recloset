// 確定のあとに再取得させる画面。confirmed だけでなく unchanged（確定は済んでいたが応答が届かなかった再送）でも
// 画面を新しくする。stale（ほかの画面で先に変更された）では何も変えていないので、何もしない。
export function outfitPathsToRevalidate(
  status: "confirmed" | "unchanged" | "stale",
  outfitId: string,
  itemIds: readonly string[],
): string[] {
  if (status === "stale") return [];
  return [
    `/protected/looks/${outfitId}`,
    ...[...new Set(itemIds)].map((id) => `/protected/items/${id}`),
  ];
}
