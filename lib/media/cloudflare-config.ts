// Cloudflare 関連の環境変数を読む。使う場面ごとに読む範囲を分けてあるのは、
// 初期設定のスクリプトが、まだ鍵や配信 ID のない状態でも動くようにするため。
// エラーメッセージには変数名だけを入れ、値は絶対に入れない。

type Env = Record<string, string | undefined>;

export type CloudflareApiConfig = { accountId: string; apiToken: string };

export type CloudflareConfig = CloudflareApiConfig & {
  imagesAccountHash: string;
  imagesSigningKey: string;
  streamCustomerCode: string;
  streamSigningKeyId: string;
  streamSigningJwk: string;
};

// 必要な環境変数をまとめて読み、足りない名前をすべて挙げて例外にする
function readRequired<K extends string>(env: Env, names: Record<K, string>): Record<K, string> {
  const missing: string[] = [];
  const result = {} as Record<K, string>;
  for (const key of Object.keys(names) as K[]) {
    const value = env[names[key]];
    if (value) {
      result[key] = value;
    } else {
      missing.push(names[key]);
    }
  }
  if (missing.length > 0) {
    throw new Error(`環境変数が足りません: ${missing.join(", ")}`);
  }
  return result;
}

export function readCloudflareApiConfig(env: Env = process.env): CloudflareApiConfig {
  return readRequired(env, {
    accountId: "CLOUDFLARE_ACCOUNT_ID",
    apiToken: "CLOUDFLARE_API_TOKEN",
  });
}

export function readCloudflareConfig(env: Env = process.env): CloudflareConfig {
  return readRequired(env, {
    accountId: "CLOUDFLARE_ACCOUNT_ID",
    apiToken: "CLOUDFLARE_API_TOKEN",
    imagesAccountHash: "CLOUDFLARE_IMAGES_ACCOUNT_HASH",
    imagesSigningKey: "CLOUDFLARE_IMAGES_SIGNING_KEY",
    streamCustomerCode: "CLOUDFLARE_STREAM_CUSTOMER_CODE",
    streamSigningKeyId: "CLOUDFLARE_STREAM_SIGNING_KEY_ID",
    streamSigningJwk: "CLOUDFLARE_STREAM_SIGNING_JWK",
  });
}

// webhook のルートは、署名の秘密だけを読む
export function readStreamWebhookSecret(env: Env = process.env): string {
  return readRequired(env, { secret: "CLOUDFLARE_STREAM_WEBHOOK_SECRET" }).secret;
}
