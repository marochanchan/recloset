// Cloudflare の写真・動画の一通りの動作確認。作ったものは最後に必ず消す。
//
// 使い方:
//   node --env-file=.env.local scripts/smoke-cloudflare.mts <服の写真.jpg> <動画.mp4>
//
// 失敗した段階を表示して、終了コード1で止まる。秘密は表示しない。

import { readFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { basename } from "node:path";
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

const { createCloudflareApi } = await import("../lib/media/cloudflare-api.ts");
const { readCloudflareApiConfig, readCloudflareConfig } = await import("../lib/media/cloudflare-config.ts");
const { buildStreamUrls } = await import("../lib/media/cloudflare-signing.ts");
const { createCloudflareMediaStore, mapStreamState } = await import("../lib/media/media-store.ts");
const { upsertEnvFile } = await import("./lib/env-file.mts");
const { formatStageError, StageFailure } = await import("./lib/stage-error.mts");
const { analyzeClothingImage } = await import("../lib/clothing-image-analysis.ts");

const ENV_PATH = `${repoRoot}.env.local`;
const [photoPath, videoPath] = process.argv.slice(2);
if (!photoPath || !videoPath) {
  console.error("使い方: node --env-file=.env.local scripts/smoke-cloudflare.mts <写真.jpg> <動画.mp4>");
  process.exit(1);
}

// 表示用に整えた失敗（段階の名前と番号だけを持つ）
class StageError extends Error {}
const step = (name: string, fn: () => Promise<string | void>) =>
  fn().then(
    (note) => console.log(`ok: ${name}${note ? `（${note}）` : ""}`),
    (error: unknown) => {
      throw new StageError(formatStageError(name, error));
    },
  );
// 設定を読む処理の失敗は、足りない変数の名前（値は入っていない）をそのまま見せる
function readSettings<T>(read: () => T): T {
  try {
    return read();
  } catch (error) {
    throw new StageFailure(error instanceof Error ? error.message : "設定を読めませんでした");
  }
}
// 1回の通信は30秒で打ち切る。止まったままにならないようにする
const timedFetch: typeof fetch = (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(30_000) });
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// 作ったものの ID。途中で失敗しても、最後に消す
const created: { kind: "photo" | "video"; id: string }[] = [];
let failed = false;

try {
  let api!: ReturnType<typeof createCloudflareApi>;
  await step("0. 設定の読み込み（API）", async () => {
    api = createCloudflareApi(readSettings(() => readCloudflareApiConfig()), timedFetch);
  });
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000);
  let imageId = "";
  let videoId = "";
  let accountHash = process.env.CLOUDFLARE_IMAGES_ACCOUNT_HASH ?? "";
  let customerCode = process.env.CLOUDFLARE_STREAM_CUSTOMER_CODE ?? "";

  await step("1. 写真のアップロードと確認", async () => {
    const upload = await api.createImageUpload({ metadata: { purpose: "smoke" }, expiresAt });
    imageId = upload.id;
    created.push({ kind: "photo", id: imageId });
    const form = new FormData();
    form.set("file", new Blob([await readFile(photoPath)], { type: "image/jpeg" }), basename(photoPath));
    const res = await timedFetch(upload.uploadURL, { method: "POST", body: form });
    if (!res.ok) throw new StageFailure(`アップロードが通りませんでした status=${res.status}`);
    const image = await api.getImage(imageId);
    if (!image) throw new StageFailure("アップロードした写真が見つかりません");
    if (image.draft) throw new StageFailure("写真がまだ draft のままです");
    if (!accountHash) {
      // 配信 URL（https://imagedelivery.net/<hash>/<id>/<variant>）から取り出す
      const match = image.variants.map((v) => /^https:\/\/imagedelivery\.net\/([^/]+)\//.exec(v)?.[1]).find(Boolean);
      if (!match) throw new StageFailure("配信 URL からアカウントのハッシュを取り出せませんでした");
      accountHash = match;
      await upsertEnvFile(ENV_PATH, "CLOUDFLARE_IMAGES_ACCOUNT_HASH", accountHash);
      return "書き込みました：CLOUDFLARE_IMAGES_ACCOUNT_HASH";
    }
  });

  await step("2. 動画のアップロードと処理の完了", async () => {
    const upload = await api.createStreamUpload({ meta: { purpose: "smoke" }, expiresAt });
    videoId = upload.uid;
    created.push({ kind: "video", id: videoId });
    const form = new FormData();
    form.set("file", new Blob([await readFile(videoPath)], { type: "video/mp4" }), basename(videoPath));
    const res = await timedFetch(upload.uploadURL, { method: "POST", body: form });
    if (!res.ok) throw new StageFailure(`アップロードが通りませんでした status=${res.status}`);

    // 5秒ごとに確かめる。3分の期限は通信の時間も含めて数える
    let preview: string | null = null;
    let ready = false;
    const deadline = Date.now() + 3 * 60 * 1000;
    while (Date.now() < deadline) {
      const video = await api.getStreamVideo(videoId);
      if (!video) throw new StageFailure("アップロードした動画が見つかりません");
      const state = mapStreamState({ state: video.state, readyToStream: video.readyToStream });
      if (state === "failed") throw new StageFailure("Stream が動画の処理に失敗しました");
      if (state === "ready") {
        preview = video.preview;
        ready = true;
        break;
      }
      await sleep(5000);
    }
    if (!ready) throw new StageFailure("3分待っても動画が ready になりませんでした");
    if (!customerCode) {
      const match = preview ? /^https:\/\/customer-([^.]+)\.cloudflarestream\.com\//.exec(preview)?.[1] : undefined;
      if (!match) throw new StageFailure("preview の URL から customer code を取り出せませんでした");
      customerCode = match;
      await upsertEnvFile(ENV_PATH, "CLOUDFLARE_STREAM_CUSTOMER_CODE", customerCode);
      return "書き込みました：CLOUDFLARE_STREAM_CUSTOMER_CODE";
    }
  });

  let store!: ReturnType<typeof createCloudflareMediaStore>;
  await step("3. 設定の読み込み（署名の鍵など）", async () => {
    const config = readSettings(() =>
      readCloudflareConfig({
        ...process.env,
        CLOUDFLARE_IMAGES_ACCOUNT_HASH: accountHash,
        CLOUDFLARE_STREAM_CUSTOMER_CODE: customerCode,
      }),
    );
    store = createCloudflareMediaStore(config, api);
  });
  const now = new Date();
  const status = async (url: string) => (await timedFetch(url)).status;

  await step("4. 写真の署名", async () => {
    const unsigned = await status(`https://imagedelivery.net/${accountHash}/${imageId}/thumb`);
    if (unsigned === 200) throw new StageFailure("署名なしで取得できてしまいます");
    for (const variant of ["thumb", "display", "analysis"] as const) {
      const code = await status(store.signedImageUrl(imageId, variant, now));
      if (code !== 200) throw new StageFailure(`${variant} の署名付き URL が ${code} でした`);
    }
  });

  await step("5. AI の入力", async () => {
    const res = await timedFetch(store.signedImageUrl(imageId, "analysis", now));
    const analysis = await analyzeClothingImage(new Uint8Array(await res.arrayBuffer()));
    return `category=${analysis.category}`;
  });

  await step("6. 動画の署名", async () => {
    const open = buildStreamUrls({ customerCode, token: videoId });
    for (const url of [open.manifestUrl, open.thumbnailUrl]) {
      if ((await status(url)) === 200) throw new StageFailure("署名なしで取得できてしまいます");
    }
    const signed = store.signedStreamUrls(videoId, now);
    for (const url of [signed.manifestUrl, signed.thumbnailUrl]) {
      const code = await status(url);
      if (code !== 200) throw new StageFailure(`署名付き URL が ${code} でした`);
    }
  });
} catch (error) {
  failed = true;
  console.error(`失敗：${error instanceof StageError ? error.message : formatStageError("実行", error)}`);
} finally {
  // 7. 後片付け。途中で失敗していても消す
  try {
    const api = createCloudflareApi(readCloudflareApiConfig(), timedFetch);
    for (const item of created) {
      try {
        if (item.kind === "photo") {
          await api.deleteImage(item.id);
          if ((await api.getImage(item.id)) !== null) throw new StageFailure("まだ残っています");
        } else {
          await api.deleteStreamVideo(item.id);
          if ((await api.getStreamVideo(item.id)) !== null) throw new StageFailure("まだ残っています");
        }
      } catch {
        // 秘密は出さず、手で消せるように ID と種類だけ出す
        console.error(`消せませんでした：${item.kind === "photo" ? "写真" : "動画"} ${item.id}`);
        failed = true;
      }
    }
    if (!failed) console.log("ok: 7. 後片付け（写真と動画を削除しました）");
  } catch {
    console.error("後片付けを始められませんでした。作ったものがあれば手で消してください。");
    for (const item of created) console.error(`${item.kind === "photo" ? "写真" : "動画"} ${item.id}`);
    failed = true;
  }
}
if (failed) process.exit(1);
