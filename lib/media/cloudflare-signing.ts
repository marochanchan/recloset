// Cloudflare Images / Stream の署名まわり（純粋な関数。ネットワークには出ない）。

import { createHmac, createPrivateKey, createSign, timingSafeEqual } from "node:crypto";

const toUnixSec = (date: Date) => Math.floor(date.getTime() / 1000);

// Images の署名付き配信 URL：「/hash/id/variant?exp=...」の HMAC-SHA256 を sig に付ける
export function signImagesDeliveryUrl(input: {
  accountHash: string;
  imageId: string;
  variant: "thumb" | "display" | "analysis";
  signingKey: string;
  expiresAt: Date;
}): string {
  const path = `/${input.accountHash}/${input.imageId}/${input.variant}`;
  const pathWithExp = `${path}?exp=${toUnixSec(input.expiresAt)}`;
  const sig = createHmac("sha256", input.signingKey).update(pathWithExp).digest("hex");
  return `https://imagedelivery.net${pathWithExp}&sig=${sig}`;
}

// Stream の署名付きトークン（RS256 の JWT）。時計のずれに備えて nbf は 60 秒前にする
export function createStreamToken(input: {
  videoUid: string;
  keyId: string;
  jwkBase64: string;
  expiresAt: Date;
  now: Date;
}): string {
  const jwk = JSON.parse(Buffer.from(input.jwkBase64, "base64").toString("utf8"));
  const key = createPrivateKey({ key: jwk, format: "jwk" });
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const header = encode({ alg: "RS256", kid: input.keyId });
  const payload = encode({
    sub: input.videoUid,
    kid: input.keyId,
    exp: toUnixSec(input.expiresAt),
    nbf: toUnixSec(input.now) - 60,
  });
  const signature = createSign("RSA-SHA256").update(`${header}.${payload}`).sign(key).toString("base64url");
  return `${header}.${payload}.${signature}`;
}

export function buildStreamUrls(input: { customerCode: string; token: string }): {
  manifestUrl: string;
  thumbnailUrl: string;
  previewGifUrl: string;
} {
  const base = `https://customer-${input.customerCode}.cloudflarestream.com/${input.token}`;
  return {
    manifestUrl: `${base}/manifest/video.m3u8`,
    thumbnailUrl: `${base}/thumbnails/thumbnail.jpg?time=1s`,
    previewGifUrl: `${base}/thumbnails/thumbnail.gif?time=0s&duration=3s`,
  };
}

// Stream webhook の署名確認。ヘッダーは「time=...,sig1=...」、署名対象は「time.本文」
export function verifyStreamWebhookSignature(input: {
  header: string | null;
  rawBody: string;
  secret: string;
  now: Date;
  toleranceSec?: number;
}): { ok: true } | { ok: false; reason: "missing" | "malformed" | "expired" | "mismatch" } {
  if (!input.header) return { ok: false, reason: "missing" };
  const parts = new Map<string, string>();
  for (const part of input.header.split(",")) {
    const index = part.indexOf("=");
    if (index > 0) parts.set(part.slice(0, index).trim(), part.slice(index + 1).trim());
  }
  const time = parts.get("time");
  const sig1 = parts.get("sig1");
  if (!time || !sig1 || !/^\d+$/.test(time) || !/^[0-9a-f]+$/i.test(sig1)) {
    return { ok: false, reason: "malformed" };
  }
  const tolerance = input.toleranceSec ?? 300;
  if (Math.abs(toUnixSec(input.now) - Number(time)) > tolerance) return { ok: false, reason: "expired" };
  const expected = Buffer.from(
    createHmac("sha256", input.secret).update(`${time}.${input.rawBody}`).digest("hex"),
  );
  const actual = Buffer.from(sig1.toLowerCase());
  // 長さが違うと timingSafeEqual が例外になるので、先に弾く
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return { ok: false, reason: "mismatch" };
  }
  return { ok: true };
}
