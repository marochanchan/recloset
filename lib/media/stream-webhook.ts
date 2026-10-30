import { verifyStreamWebhookSignature } from "@/lib/media/cloudflare-signing";
import { mapStreamState } from "@/lib/media/media-store";

// Stream の完了通知（webhook）の処理。署名を確かめてから、本文を読んで apply に渡す。
// DB への反映は apply の側（呼び出し元）が行う。

export type StreamWebhookPayload = {
  assetId: string;
  status: "processing" | "ready" | "failed";
  width: number | null;
  height: number | null;
  durationSec: number | null;
};

export type StreamWebhookApplyResult = "applied" | "ignored" | "duplicate";

// -1 や値なしは「まだ分からない」として null にする
const positiveOrNull = (value: unknown): number | null =>
  typeof value === "number" && value > 0 ? value : null;

export async function handleStreamWebhook(input: {
  header: string | null;
  rawBody: string;
  secret: string;
  now: Date;
  apply: (payload: StreamWebhookPayload) => Promise<StreamWebhookApplyResult>;
}): Promise<{ status: 200 | 400 | 401; result?: string }> {
  // 署名は生の本文で確かめる。通らなければ本文は読まない
  const verified = verifyStreamWebhookSignature({
    header: input.header,
    rawBody: input.rawBody,
    secret: input.secret,
    now: input.now,
  });
  if (!verified.ok) return { status: 401 };

  let body: {
    uid?: unknown;
    readyToStream?: unknown;
    status?: { state?: unknown };
    input?: { width?: unknown; height?: unknown };
    duration?: unknown;
  };
  try {
    body = JSON.parse(input.rawBody);
  } catch {
    return { status: 400 };
  }
  if (typeof body !== "object" || body === null || typeof body.uid !== "string" || body.uid === "") {
    return { status: 400 };
  }

  const state = mapStreamState({
    state: typeof body.status?.state === "string" ? body.status.state : null,
    readyToStream: body.readyToStream === true,
  });
  // 反映するものがない状態（アップロード待ち・不明）は、何もせず受け取ったことだけ返す
  if (state === "awaiting_upload" || state === "missing") {
    return { status: 200, result: "ignored" };
  }

  const result = await input.apply({
    assetId: body.uid,
    status: state,
    width: positiveOrNull(body.input?.width),
    height: positiveOrNull(body.input?.height),
    durationSec: positiveOrNull(body.duration),
  });
  return { status: 200, result };
}
