// Cloudflare（Images / Stream）の初期設定。何度実行しても同じ結果になる。
//
// 使い方:
//   node --env-file=.env.local scripts/setup-cloudflare.mts --check
//   node --env-file=.env.local scripts/setup-cloudflare.mts [--stream-key] [--webhook <URL> [--preview]]
//   （--preview は、通知先が Vercel のプレビューのときだけ付ける）
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
const { CloudflareApiError } = await import("../lib/media/cloudflare-api.ts");
const { upsertEnvFile } = await import("./lib/env-file.mts");
const { formatStageError, StageFailure } = await import("./lib/stage-error.mts");

const ENV_PATH = `${repoRoot}.env.local`;
const args = process.argv.slice(2);
const checkOnly = args.includes("--check");
const wantStreamKey = args.includes("--stream-key");
const forceStreamKey = args.includes("--force");
const isPreview = args.includes("--preview");
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

// Cloudflare の API を呼び、result を返す。トークンはヘッダーにだけ使い、エラーには入れない
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
  let envelope: { success?: boolean; errors?: { code?: number }[]; result?: T };
  try {
    envelope = JSON.parse(text);
  } catch {
    throw new CloudflareApiError("応答が JSON ではありません", response.status);
  }
  if (!response.ok || envelope.success === false) {
    // 文言は持たせず、番号だけを持たせる
    const codes = (envelope.errors ?? []).map((e) => e.code).filter((c): c is number => typeof c === "number");
    throw new CloudflareApiError("Cloudflare のエラー", response.status, codes);
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

// 保存済みの JWK が、保存済みの鍵 ID と対になっているか
function streamKeyIsComplete(): boolean {
  const id = process.env.CLOUDFLARE_STREAM_SIGNING_KEY_ID;
  const jwk = process.env.CLOUDFLARE_STREAM_SIGNING_JWK;
  if (!id || !jwk) return false;
  try {
    const parsed = JSON.parse(Buffer.from(jwk, "base64").toString("utf8")) as { kid?: unknown };
    return typeof parsed === "object" && parsed !== null && parsed.kid === id;
  } catch {
    return false;
  }
}

async function createStreamKey() {
  if (streamKeyIsComplete() && !forceStreamKey) {
    console.log("Stream の署名の鍵はすでにあります。作り直すときは --stream-key --force を付けてください。");
    return;
  }
  const key = await cf<{ id: string; jwk: string }>("POST", "/stream/keys");
  // JWK を先に、鍵 ID をあとに書く。途中で止まっても「そろった」とは見なされない
  await writeEnv("CLOUDFLARE_STREAM_SIGNING_JWK", key.jwk);
  await writeEnv("CLOUDFLARE_STREAM_SIGNING_KEY_ID", key.id);
}

async function registerWebhook(url: string) {
  console.log("注意：Stream の通知先はアカウントに1つだけです。登録し直すと、前の通知先は使われなくなります。");
  let target: URL;
  try {
    target = new URL(url);
  } catch {
    throw new StageFailure("通知先の URL の形が正しくありません");
  }
  // 保護を通る付け足しは、--preview のときだけ。URL は画面に出さない
  if (isPreview) {
    const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
    if (bypass) {
      target.searchParams.set("x-vercel-protection-bypass", bypass);
      console.log("保護を通る設定を付けました");
    } else {
      console.log("VERCEL_AUTOMATION_BYPASS_SECRET がないため、保護を通る設定なしで登録します");
    }
  }
  const put = await cf<{ secret?: string }>("PUT", "/stream/webhook", { notificationUrl: target.toString() });
  const secret = put.secret ?? (await cf<{ secret?: string }>("GET", "/stream/webhook")).secret;
  if (!secret) throw new StageFailure("通知の秘密を取り出せませんでした。もう一度試してください");
  const previous = process.env.CLOUDFLARE_STREAM_WEBHOOK_SECRET;
  await writeEnv("CLOUDFLARE_STREAM_WEBHOOK_SECRET", secret);
  console.log(
    previous === secret
      ? "秘密は前と同じです"
      : "秘密が変わりました。Vercel の値を入れ直してください",
  );
}

// 段階ごとに包み、失敗したときは段階の名前と番号だけを出す
async function stage(name: string, fn: () => Promise<void>) {
  try {
    await fn();
  } catch (error) {
    console.error(formatStageError(name, error));
    process.exit(1);
  }
}

if (checkOnly) {
  await stage("読み取りの確認", check);
} else {
  await stage("バリアントの設定", ensureVariants);
  await stage("Images の署名の鍵", writeImagesKey);
  if (wantStreamKey) await stage("Stream の署名の鍵", createStreamKey);
  if (webhookUrl) await stage("Stream の通知先", () => registerWebhook(webhookUrl));
  console.log("終わりました。Vercel に入れる値は、.env.local を開いてコピーしてください。");
}
