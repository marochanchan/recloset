import { readStreamWebhookSecret } from "@/lib/media/cloudflare-config";
import {
  handleStreamWebhook,
  type StreamWebhookApplyResult,
} from "@/lib/media/stream-webhook";
import { createAdminClient } from "@/lib/supabase/admin";

class StreamWebhookApplyError extends Error {
  constructor(public code: string | null) {
    super("apply_stream_webhook failed");
  }
}

// Cloudflare Stream からの完了通知。署名の秘密だけを読む。
export async function POST(request: Request) {
  // 署名は生の本文で確かめるため、JSON にせず text() で読む
  const rawBody = await request.text();
  let secret: string;
  try {
    secret = readStreamWebhookSecret();
  } catch {
    // 秘密が未設定。変数名はログに出すが値はない
    console.error("CLOUDFLARE_STREAM_WEBHOOK_SECRET が設定されていません");
    return new Response(null, { status: 500 });
  }

  let outcome: Awaited<ReturnType<typeof handleStreamWebhook>>;
  try {
    outcome = await handleStreamWebhook({
      header: request.headers.get("webhook-signature"),
      rawBody,
      secret,
      now: new Date(),
      apply: async (payload) => {
        const { data, error } = await createAdminClient().rpc(
          "apply_stream_webhook",
          {
            p_asset_id: payload.assetId,
            p_status: payload.status,
            p_width: payload.width,
            p_height: payload.height,
            p_duration_sec: payload.durationSec,
          },
        );
        if (error) {
          // message には外部の文面が入りうるので出さない。5xx にして Cloudflare に再送させる
          throw new StreamWebhookApplyError(error.code ?? null);
        }
        return data as StreamWebhookApplyResult;
      },
    });
  } catch (error) {
    console.error("stream webhook apply failed", {
      code: error instanceof StreamWebhookApplyError ? error.code : null,
    });
    return new Response(null, { status: 500 });
  }

  return Response.json(
    { result: outcome.result ?? null },
    { status: outcome.status },
  );
}
