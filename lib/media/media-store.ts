import type { CloudflareApi } from "@/lib/media/cloudflare-api";
import type { CloudflareConfig } from "@/lib/media/cloudflare-config";
import { buildStreamUrls, createStreamToken, signImagesDeliveryUrl } from "@/lib/media/cloudflare-signing";

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

// 配信 URL の有効期間
const DELIVERY_TTL_MS = 60 * 60 * 1000;

export function createCloudflareMediaStore(config: CloudflareConfig, api: CloudflareApi): MediaStore {
  return {
    async createUpload(input) {
      const meta = { userId: input.userId, mediaId: input.mediaId };
      if (input.kind === "photo") {
        const upload = await api.createImageUpload({ metadata: meta, expiresAt: input.expiresAt });
        return { provider: "cf_images", assetId: upload.id, uploadUrl: upload.uploadURL };
      }
      const upload = await api.createStreamUpload({ meta, expiresAt: input.expiresAt });
      return { provider: "cf_stream", assetId: upload.uid, uploadUrl: upload.uploadURL };
    },

    async getAssetState(provider: MediaProvider, assetId: string): Promise<AssetState> {
      if (provider === "cf_images") {
        const image = await api.getImage(assetId);
        if (!image) return { state: "missing" };
        return { state: image.draft ? "awaiting_upload" : "ready" };
      }
      const video = await api.getStreamVideo(assetId);
      if (!video) return { state: "missing" };
      const state = mapStreamState({ state: video.state, readyToStream: video.readyToStream });
      if (state !== "ready") return { state };
      const result: AssetState = { state };
      if (video.width !== null) result.width = video.width;
      if (video.height !== null) result.height = video.height;
      if (video.duration !== null) result.durationSec = video.duration;
      return result;
    },

    deleteAsset(provider, assetId) {
      return provider === "cf_images" ? api.deleteImage(assetId) : api.deleteStreamVideo(assetId);
    },

    signedImageUrl(assetId, variant, now) {
      return signImagesDeliveryUrl({
        accountHash: config.imagesAccountHash,
        imageId: assetId,
        variant,
        signingKey: config.imagesSigningKey,
        expiresAt: new Date(now.getTime() + DELIVERY_TTL_MS),
      });
    },

    signedStreamUrls(assetId, now) {
      const token = createStreamToken({
        videoUid: assetId,
        keyId: config.streamSigningKeyId,
        jwkBase64: config.streamSigningJwk,
        expiresAt: new Date(now.getTime() + DELIVERY_TTL_MS),
        now,
      });
      return buildStreamUrls({ customerCode: config.streamCustomerCode, token });
    },
  };
}
