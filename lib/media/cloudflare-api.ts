// Cloudflare Images / Stream の API 呼び出し。fetch は差し替えられるので、テストはネットワークに出ない。
// トークンはヘッダーにだけ使い、エラーメッセージやログには入れない。

import type { CloudflareApiConfig } from "@/lib/media/cloudflare-config";

export class CloudflareApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "CloudflareApiError";
    this.status = status;
  }
}

type CloudflareErrorItem = { code?: number; message?: string };
type Envelope = { success?: boolean; errors?: CloudflareErrorItem[]; result?: unknown };

export type StreamVideoInfo = {
  state: string | null;
  readyToStream: boolean;
  width: number | null;
  height: number | null;
  duration: number | null;
  preview: string | null;
};

// -1 や値なしは「まだ分からない」として null にする
const positiveOrNull = (value: unknown): number | null =>
  typeof value === "number" && value > 0 ? value : null;

export function createCloudflareApi(config: CloudflareApiConfig, fetchImpl: typeof fetch = fetch) {
  const base = `https://api.cloudflare.com/client/v4/accounts/${config.accountId}`;

  // 応答は { success, errors, result }。404 は allowNotFound のとき null を返し、それ以外の失敗は例外にする
  async function call(
    method: string,
    path: string,
    options: { body?: FormData | string; json?: boolean; allowNotFound?: boolean; allowEmptyBody?: boolean } = {},
  ): Promise<{ result: unknown } | null> {
    const headers: Record<string, string> = { Authorization: `Bearer ${config.apiToken}` };
    if (options.json) headers["Content-Type"] = "application/json";
    const response = await fetchImpl(`${base}${path}`, { method, headers, body: options.body });
    if (response.status === 404 && options.allowNotFound) return null;
    // 本文が JSON として読めないときは、成功とは見なさず例外にする（2xx の空本文は allowEmptyBody のときだけ許す）
    let envelope: Envelope = {};
    const text = await response.text();
    if (text.trim() === "" && response.ok && options.allowEmptyBody) {
      return { result: null };
    }
    try {
      envelope = JSON.parse(text) as Envelope;
    } catch {
      throw new CloudflareApiError(
        `Cloudflare API の応答が JSON ではありません (${method} ${path}) status=${response.status}`,
        response.status,
      );
    }
    if (!response.ok || envelope.success === false) {
      const details = (envelope.errors ?? [])
        .map((item) => `${item.code ?? "?"}: ${item.message ?? ""}`)
        .join("; ");
      throw new CloudflareApiError(
        `Cloudflare API エラー (${method} ${path}) status=${response.status}${details ? ` ${details}` : ""}`,
        response.status,
      );
    }
    return { result: envelope.result };
  }

  return {
    async createImageUpload(input: {
      metadata: Record<string, string>;
      expiresAt: Date;
    }): Promise<{ id: string; uploadURL: string }> {
      const form = new FormData();
      form.set("requireSignedURLs", "true");
      form.set("metadata", JSON.stringify(input.metadata));
      form.set("expiry", input.expiresAt.toISOString());
      const response = await call("POST", "/images/v2/direct_upload", { body: form });
      return response!.result as { id: string; uploadURL: string };
    },

    async getImage(id: string): Promise<{ draft: boolean; variants: string[] } | null> {
      const response = await call("GET", `/images/v1/${id}`, { allowNotFound: true });
      if (!response) return null;
      const result = response.result as { draft?: boolean; variants?: string[] };
      return { draft: result.draft === true, variants: result.variants ?? [] };
    },

    async deleteImage(id: string): Promise<"deleted" | "not_found"> {
      const response = await call("DELETE", `/images/v1/${id}`, { allowNotFound: true });
      return response ? "deleted" : "not_found";
    },

    async createStreamUpload(input: {
      meta: Record<string, string>;
      expiresAt: Date;
    }): Promise<{ uid: string; uploadURL: string }> {
      const response = await call("POST", "/stream/direct_upload", {
        json: true,
        body: JSON.stringify({
          maxDurationSeconds: 60,
          requireSignedURLs: true,
          meta: input.meta,
          expiry: input.expiresAt.toISOString(),
        }),
      });
      return response!.result as { uid: string; uploadURL: string };
    },

    // 公式の応答は入れ子なので、ここで平らに直す
    async getStreamVideo(uid: string): Promise<StreamVideoInfo | null> {
      const response = await call("GET", `/stream/${uid}`, { allowNotFound: true });
      if (!response) return null;
      const result = response.result as {
        status?: { state?: string };
        readyToStream?: boolean;
        input?: { width?: number; height?: number };
        duration?: number;
        preview?: string;
      };
      return {
        state: result.status?.state ?? null,
        readyToStream: result.readyToStream === true,
        width: positiveOrNull(result.input?.width),
        height: positiveOrNull(result.input?.height),
        duration: positiveOrNull(result.duration),
        preview: result.preview ?? null,
      };
    },

    async deleteStreamVideo(uid: string): Promise<"deleted" | "not_found"> {
      const response = await call("DELETE", `/stream/${uid}`, { allowNotFound: true, allowEmptyBody: true });
      return response ? "deleted" : "not_found";
    },
  };
}

export type CloudflareApi = ReturnType<typeof createCloudflareApi>;
