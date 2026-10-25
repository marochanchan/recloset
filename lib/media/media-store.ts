// 写真・動画の置き場（Cloudflare Images / Stream）を、サービス側から同じ形で扱うための型。

export type MediaProvider = "cf_images" | "cf_stream";

export type AssetState = {
  state: "missing" | "awaiting_upload" | "processing" | "ready" | "failed";
  width?: number;
  height?: number;
  durationSec?: number;
};

export interface MediaStore {
  createUpload(input: {
    kind: "photo" | "video";
    userId: string;
    mediaId: string;
    expiresAt: Date;
  }): Promise<{ provider: MediaProvider; assetId: string; uploadUrl: string }>;
  getAssetState(provider: MediaProvider, assetId: string): Promise<AssetState>;
  deleteAsset(provider: MediaProvider, assetId: string): Promise<"deleted" | "not_found">;
  signedImageUrl(assetId: string, variant: "thumb" | "display" | "analysis", now: Date): string;
  signedStreamUrls(
    assetId: string,
    now: Date,
  ): { manifestUrl: string; thumbnailUrl: string; previewGifUrl: string };
}

// Stream の状態の対応。ポーリング・完了の知らせ・webhook のすべてでこれを使う
export function mapStreamState(input: {
  state: string | null;
  readyToStream: boolean;
}): AssetState["state"] {
  switch (input.state) {
    case null:
      return "missing";
    case "pendingupload":
      return "awaiting_upload";
    case "error":
      return "failed";
    case "ready":
      // ready でも再生の準備ができるまでは処理中として扱う
      return input.readyToStream ? "ready" : "processing";
    default:
      // downloading・queued・inprogress と、知らない値
      return "processing";
  }
}
