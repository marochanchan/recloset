// サービスのテスト用のダミー MediaStore。ネットワークにも署名にも依存しない。

import type { AssetState, MediaProvider, MediaStore } from "@/lib/media/media-store";

export function createFakeMediaStore(): MediaStore & {
  assets: Map<string, AssetState & { provider: MediaProvider }>;
  setState(assetId: string, s: AssetState): void;
  failNextDelete(error: Error): void;
} {
  const assets = new Map<string, AssetState & { provider: MediaProvider }>();
  let counter = 0;
  let nextDeleteError: Error | null = null;

  return {
    assets,

    async createUpload(input) {
      counter += 1;
      const provider: MediaProvider = input.kind === "photo" ? "cf_images" : "cf_stream";
      const assetId = `fake-${input.kind}-${counter}`;
      assets.set(assetId, { provider, state: "awaiting_upload" });
      return { provider, assetId, uploadUrl: `https://fake-upload.example/${assetId}` };
    },

    async getAssetState(_provider, assetId) {
      const asset = assets.get(assetId);
      if (!asset) return { state: "missing" };
      const { provider: _ignored, ...state } = asset;
      return state;
    },

    async deleteAsset(_provider, assetId) {
      // 1回だけ失敗させる
      if (nextDeleteError) {
        const error = nextDeleteError;
        nextDeleteError = null;
        throw error;
      }
      return assets.delete(assetId) ? "deleted" : "not_found";
    },

    signedImageUrl(assetId, variant, now) {
      return `https://fake-images.example/${assetId}/${variant}?exp=${Math.floor(now.getTime() / 1000) + 3600}`;
    },

    signedStreamUrls(assetId) {
      const base = `https://fake-stream.example/${assetId}`;
      return {
        manifestUrl: `${base}/manifest/video.m3u8`,
        thumbnailUrl: `${base}/thumbnails/thumbnail.jpg`,
        previewGifUrl: `${base}/thumbnails/thumbnail.gif`,
      };
    },

    setState(assetId, s) {
      const asset = assets.get(assetId);
      if (!asset) throw new Error(`資産がありません: ${assetId}`);
      assets.set(assetId, { provider: asset.provider, ...s });
    },

    failNextDelete(error) {
      nextDeleteError = error;
    },
  };
}
