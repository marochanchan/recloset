// Cloudflare（Images / Stream）の初期設定。何度実行しても同じ結果になる。
//
// 使い方:
//   node --env-file=.env.local scripts/setup-cloudflare.mts --check
//   node --env-file=.env.local scripts/setup-cloudflare.mts [--stream-key] [--webhook <URL>]
//
// 鍵や秘密は .env.local の該当する行に書き込むだけで、画面には変数名しか出さない。
// 取り出した値は Vercel にも入れる必要がある（.env.local を開いてコピーしてください）。

import { registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      return nextResolve(pathToFileURL(`${repoRoot}${specifier.slice(2)}.ts`).href, context);
    }
    return nextResolve(specifier, context);
  },
});

const { readCloudflareApiConfig } = await import("../lib/media/cloudflare-config.ts");
const { upsertEnvFile } = await import("./lib/env-file.mts");

const ENV_PATH = `${repoRoot}.env.local`;
const args = process.argv.slice(2);
const checkOnly = args.includes("--check");
const wantStreamKey = args.includes("--stream-key");
const forceStreamKey = args.includes("--force");
const webhookIndex = args.indexOf("--webhook");
const webhookUrl = webhookIndex >= 0 ? args[webhookIndex + 1] : undefined;

if (webhookIndex >= 0 && (!webhookUrl || webhookUrl.startsWith("--"))) {
  console.error("--webhook のあとに通知先の URL を指定してください。");
  process.exit(1);
}

let config: ReturnType<typeof readCloudflareApiConfig>;
try {
  config = readCloudflareApiConfig();
} catch (error) {
  // 変数名だけが入ったメッセージ
  console.error((error as Error).message);
  console.error(".env.local に入れてから、--env-file=.env.local を付けて実行してください。");
  process.exit(1);
}

const base = `https://api.cloudflare.com/client/v4/accounts/${config.accountId}`;

// Cloudflare の API を呼び、result を返す。トークンはヘッダーにだけ使い、メッセージには入れない
async function cf<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${config.apiToken}`,
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let envelope: { success?: boolean; errors?: { code?: number; message?: string }[]; result?: T };
  try {
    envelope = JSON.parse(text);
  } catch {
    throw new Error(`Cloudflare の応答が JSON ではありません (${method} ${path}) status=${response.status}`);
  }
  if (!response.ok || envelope.success === false) {
    const details = (envelope.errors ?? []).map((e) => `${e.code ?? "?"}: ${e.message ?? ""}`).join("; ");
    throw new Error(`Cloudflare のエラー (${method} ${path}) status=${response.status}${details ? ` ${details}` : ""}`);
  }
  return envelope.result as T;
}

type Variant = {
  id: string;
  options?: { fit?: string; width?: number; height?: number; metadata?: string };
  neverRequireSignedURLs?: boolean;
};

// 長辺 N px に収める（scale-down）ので、幅と高さの両方に N を入れる
const WANTED_VARIANTS = [
  { id: "thumb", size: 480 },
  { id: "display", size: 1600 },
  { id: "analysis", size: 2048 },
];

async function listVariants(): Promise<Record<string, Variant>> {
  const result = await cf<{ variants?: Record<string, Variant> }>("GET", "/images/v1/variants");
  return result.variants ?? {};
}

async function writeEnv(name: string, value: string) {
  await upsertEnvFile(ENV_PATH, name, value);
  console.log(`書き込みました：${name}`);
}

async function check() {
  const stats = await cf<{ count?: { allowed?: number; current?: number } }>("GET", "/images/v1/stats");
  console.log(`Images：${stats.count?.current ?? "?"} 枚 / 上限 ${stats.count?.allowed ?? "?"} 枚`);

  const usage = await cf<{ totalStorageMinutes?: number; totalStorageMinutesLimit?: number; videoCount?: number }>(
    "GET",
    "/stream/storage-usage",
  );
  console.log(
    `Stream：${usage.totalStorageMinutes ?? "?"} 分 / 保存できる ${usage.totalStorageMinutesLimit ?? "?"} 分（動画 ${usage.videoCount ?? "?"} 本）`,
  );

  const variants = await listVariants();
  const ids = Object.keys(variants);
  if (ids.length === 0) console.log("バリアント：まだありません");
  for (const id of ids) {
    console.log(`バリアント ${id}：neverRequireSignedURLs=${variants[id].neverRequireSignedURLs === true}`);
  }
}

async function ensureVariants() {
  const existing = await listVariants();
  for (const wanted of WANTED_VARIANTS) {
    const options = { fit: "scale-down", width: wanted.size, height: wanted.size, metadata: "none" };
    const current = existing[wanted.id];
    if (!current) {
      await cf("POST", "/images/v1/variants", { id: wanted.id, options, neverRequireSignedURLs: false });
      console.log(`バリアント ${wanted.id} を作りました`);
    } else if (current.neverRequireSignedURLs === true) {
      await cf("PATCH", `/images/v1/variants/${wanted.id}`, { options, neverRequireSignedURLs: false });
      console.log(`バリアント ${wanted.id} の署名の設定を直しました`);
    } else {
      console.log(`バリアント ${wanted.id} はそのままです`);
    }
  }

  // 読み直して、署名なしで配れる状態が残っていないことを確かめる
  const after = await listVariants();
  const open = Object.values(after).filter((v) => v.neverRequireSignedURLs === true);
  if (open.length > 0) {
    console.error(`署名なしで配れるバリアントが残っています：${open.map((v) => v.id).join(", ")}`);
    process.exit(1);
  }
  console.log("ok: すべてのバリアントが署名つきの配信です");
}

async function writeImagesKey() {
  const result = await cf<{ keys?: { name?: string; value?: string }[] }>("GET", "/images/v1/keys");
  const key = result.keys?.find((k) => k.value);
  if (!key?.value) {
    console.error("Images の署名の鍵が見つかりません。ダッシュボードの Images → Keys を確かめてください。");
    process.exit(1);
  }
  await writeEnv("CLOUDFLARE_IMAGES_SIGNING_KEY", key.value);
}

async function createStreamKey() {
  if (process.env.CLOUDFLARE_STREAM_SIGNING_KEY_ID && !forceStreamKey) {
    console.log("Stream の署名の鍵はすでにあります。作り直すときは --stream-key --force を付けてください。");
    return;
  }
  const key = await cf<{ id: string; jwk: string }>("POST", "/stream/keys");
  await writeEnv("CLOUDFLARE_STREAM_SIGNING_KEY_ID", key.id);
  await writeEnv("CLOUDFLARE_STREAM_SIGNING_JWK", key.jwk);
}

async function registerWebhook(url: string) {
  console.log("注意：Stream の通知先はアカウントに1つだけです。登録し直すと、前の通知先は使われなくなります。");
  let target = url;
  const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  const isPreview = new URL(url).hostname.endsWith(".vercel.app");
  if (bypass && isPreview) {
    // プレビューの保護を通るための付け足し。URL は画面に出さない
    const u = new URL(url);
    u.searchParams.set("x-vercel-protection-bypass", bypass);
    target = u.toString();
    console.log("保護を通る設定を付けました");
  }
  const put = await cf<{ secret?: string }>("PUT", "/stream/webhook", { notificationUrl: target });
  const secret = put.secret ?? (await cf<{ secret?: string }>("GET", "/stream/webhook")).secret;
  if (!secret) {
    console.error("通知の秘密を取り出せませんでした。もう一度試してください。");
    process.exit(1);
  }
  const previous = process.env.CLOUDFLARE_STREAM_WEBHOOK_SECRET;
  await writeEnv("CLOUDFLARE_STREAM_WEBHOOK_SECRET", secret);
  console.log(
    previous === secret
      ? "秘密は前と同じです"
      : "秘密が変わりました。Vercel の値を入れ直してください",
  );
}

try {
  if (checkOnly) {
    await check();
  } else {
    await ensureVariants();
    await writeImagesKey();
    if (wantStreamKey) await createStreamKey();
    if (webhookUrl) await registerWebhook(webhookUrl);
    console.log("終わりました。Vercel に入れる値は、.env.local を開いてコピーしてください。");
  }
} catch (error) {
  // メッセージには秘密を入れていない
  console.error((error as Error).message);
  process.exit(1);
}
