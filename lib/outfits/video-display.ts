// 照会し直した動画の行から、詳細画面で使う項目を作る（純粋）。
// 試行が置き換わっていると asset ID も変わるので、古い ID を残さず行から丸ごと作る。
import type { OutfitMediaRow } from "@/lib/outfits/media-db";

export type DisplayVideo = {
  status: OutfitMediaRow["status"];
  provider_asset_id: string;
  width: number | null;
  height: number | null;
};

export function displayVideoFromRow(row: OutfitMediaRow): DisplayVideo {
  return {
    status: row.status,
    provider_asset_id: row.providerAssetId,
    width: row.width,
    height: row.height,
  };
}
