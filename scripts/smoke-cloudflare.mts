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
const { analyzeClothingImage } = await import("../lib/clothing-image-analysis.ts");

const ENV_PATH = `${repoRoot}.env.local`;
const [photoPath, videoPath] = process.argv.slice(2);
if (!photoPath || !videoPath) {
  console.error("使い方: node --env-file=.env.local scripts/smoke-cloudflare.mts <写真.jpg> <動画.mp4>");
  process.exit(1);
}

class StageError extends Error {}
const step = (name: string, fn: () => Promise<string | void>) =>
  fn().then(
    (note) => console.log(`ok: ${name}${note ? `（${note}）` : ""}`),
    (error: unknown) => {
      const message = error instanceof Error ? error.message : "原因は分かりません";
      throw new StageError(`${name}：${message}`);
    },
  );
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// 作ったものの ID。途中で失敗しても、最後に消す
const created: { kind: "photo" | "video"; id: string }[] = [];
let failed = false;

try {
  const api = createCloudflareApi(readCloudflareApiConfig());
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
    const res = await fetch(upload.uploadURL, { method: "POST", body: form });
    if (!res.ok) throw new Error(`アップロードが通りませんでした status=${res.status}`);
    const image = await api.getImage(imageId);
    if (!image) throw new Error("アップロードした写真が見つかりません");
    if (image.draft) throw new Error("写真がまだ draft のままです");
    if (!accountHash) {
      // 配信 URL（https://imagedelivery.net/<hash>/<id>/<variant>）から取り出す
      const match = image.variants.map((v) => /^https:\/\/imagedelivery\.net\/([^/]+)\//.exec(v)?.[1]).find(Boolean);
      if (!match) throw new Error("配信 URL からアカウントのハッシュを取り出せませんでした");
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
    const res = await fetch(upload.uploadURL, { method: "POST", body: form });
    if (!res.ok) throw new Error(`アップロードが通りませんでした status=${res.status}`);

    // 5秒ごとに、最大3分まで待つ
    let preview: string | null = null;
    let ready = false;
    for (let i = 0; i < 36; i++) {
      const video = await api.getStreamVideo(videoId);
      if (!video) throw new Error("アップロードした動画が見つかりません");
      const state = mapStreamState({ state: video.state, readyToStream: video.readyToStream });
      if (state === "failed") throw new Error("Stream が動画の処理に失敗しました");
      if (state === "ready") {
        preview = video.preview;
        ready = true;
        break;
      }
      await sleep(5000);
    }
    if (!ready) throw new Error("3分待っても動画が ready になりませんでした");
    if (!customerCode) {
      const match = preview ? /^https:\/\/customer-([^.]+)\.cloudflarestream\.com\//.exec(preview)?.[1] : undefined;
      if (!match) throw new Error("preview の URL から customer code を取り出せませんでした");
      customerCode = match;
      await upsertEnvFile(ENV_PATH, "CLOUDFLARE_STREAM_CUSTOMER_CODE", customerCode);
      return "書き込みました：CLOUDFLARE_STREAM_CUSTOMER_CODE";
    }
  });

  const config = readCloudflareConfig({
    ...process.env,
    CLOUDFLARE_IMAGES_ACCOUNT_HASH: accountHash,
    CLOUDFLARE_STREAM_CUSTOMER_CODE: customerCode,
  });
  const store = createCloudflareMediaStore(config, api);
  const now = new Date();
  const status = async (url: string) => (await fetch(url)).status;

  await step("4. 写真の署名", async () => {
    const unsigned = await status(`https://imagedelivery.net/${accountHash}/${imageId}/thumb`);
    if (unsigned === 200) throw new Error("署名なしで取得できてしまいます");
    for (const variant of ["thumb", "display", "analysis"] as const) {
      const code = await status(store.signedImageUrl(imageId, variant, now));
      if (code !== 200) throw new Error(`${variant} の署名付き URL が ${code} でした`);
    }
  });

  await step("5. AI の入力", async () => {
    const res = await fetch(store.signedImageUrl(imageId, "analysis", now));
    const analysis = await analyzeClothingImage(new Uint8Array(await res.arrayBuffer()));
    return `category=${analysis.category}`;
  });

  await step("6. 動画の署名", async () => {
    const open = buildStreamUrls({ customerCode, token: videoId });
    for (const url of [open.manifestUrl, open.thumbnailUrl]) {
      if ((await status(url)) === 200) throw new Error("署名なしで取得できてしまいます");
    }
    const signed = store.signedStreamUrls(videoId, now);
    for (const url of [signed.manifestUrl, signed.thumbnailUrl]) {
      const code = await status(url);
      if (code !== 200) throw new Error(`署名付き URL が ${code} でした`);
    }
  });
} catch (error) {
  failed = true;
  console.error(`失敗：${error instanceof Error ? error.message : "原因は分かりません"}`);
} finally {
  // 7. 後片付け。途中で失敗していても消す
  try {
    const api = createCloudflareApi(readCloudflareApiConfig());
    for (const item of created) {
      try {
        if (item.kind === "photo") {
          await api.deleteImage(item.id);
          if ((await api.getImage(item.id)) !== null) throw new Error("まだ残っています");
        } else {
          await api.deleteStreamVideo(item.id);
          if ((await api.getStreamVideo(item.id)) !== null) throw new Error("まだ残っています");
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
