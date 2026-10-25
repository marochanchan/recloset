import { readStreamWebhookSecret } from "@/lib/media/cloudflare-config";
import { handleStreamWebhook } from "@/lib/media/stream-webhook";

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

  const outcome = await handleStreamWebhook({
    header: request.headers.get("webhook-signature"),
    rawBody,
    secret,
    now: new Date(),
    // 仮の反映。DB へのつなぎ込みは後のタスクで行う
    apply: async (payload) => {
      console.info("stream webhook", { uid: payload.assetId, status: payload.status });
      return "ignored";
    },
  });

  return Response.json({ result: outcome.result ?? null }, { status: outcome.status });
}
