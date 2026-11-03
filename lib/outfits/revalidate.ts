// 確定のあとに再取得させる画面。confirmed だけでなく unchanged（確定は済んでいたが応答が届かなかった再送）でも
// 画面を新しくする。stale（ほかの画面で先に変更された）では何も変えていないので、何もしない。
// previousItemIds は編集のときの「直す前の服」。外した服の画面（線・着用回数）も新しくする。
export function outfitPathsToRevalidate(
  status: "confirmed" | "unchanged" | "stale",
  outfitId: string,
  itemIds: readonly string[],
  previousItemIds: readonly string[] = [],
): string[] {
  if (status === "stale") return [];
  return [
    `/protected/looks/${outfitId}`,
    "/protected/looks",
    ...[...new Set([...itemIds, ...previousItemIds])].map((id) => `/protected/items/${id}`),
  ];
}
