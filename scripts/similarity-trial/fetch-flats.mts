// 平置きの写真を本番から取ってくる（読むだけ。書き込みはしない）。
//
// 実行方法（秘密鍵は不要。アカウントごとにパスワードを聞かれる。入力は表示されない）:
//   node --env-file=.env.local scripts/similarity-trial/fetch-flats.mts --email a@example.com [--email b@example.com] [--data-dir <dir>]
//
// 各アカウントでログインし、そのユーザー自身の服と画像だけを RLS 越しに読む。
// パスワードは保存・出力しない。既にあるファイルは取り直さない（Egress の節約）。

import { createClient } from "@supabase/supabase-js";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";
import { Writable } from "node:stream";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    email: { type: "string", multiple: true },
    "data-dir": { type: "string", default: ".superpowers/similarity-trial" },
  },
});
const emails = values.email ?? [];
if (emails.length === 0) {
  console.error("--email を1つ以上指定してください");
  process.exit(1);
}
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if (!url || !key) {
  console.error("NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY が未設定です（--env-file=.env.local で実行）");
  process.exit(1);
}

// 入力を表示しないパスワード入力
function askPassword(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    let muted = false;
    const output = new Writable({
      write(chunk, _enc, cb) {
        if (!muted) process.stdout.write(chunk);
        cb();
      },
    });
    const rl = readline.createInterface({ input: process.stdin, output, terminal: true });
    rl.question(prompt, (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
    muted = true;
  });
}

const flatsDir = path.join(values["data-dir"]!, "flats");
await mkdir(flatsDir, { recursive: true });

const manifest: Record<string, unknown>[] = [];
let bytes = 0;
let downloaded = 0;
let skippedNoImage = 0;

for (const email of emails) {
  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const password = await askPassword(`${email} のパスワード: `);
  const { error: signInErr } = await supabase.auth.signInWithPassword({ email, password });
  if (signInErr) {
    console.error(`ログインに失敗しました: ${email}（メールアドレスかパスワードを確認してください）`);
    process.exit(1);
  }

  // RLS により、ログインしたユーザー自身の行だけが返る
  const { data: items, error: itemErr } = await supabase
    .from("clothing_items")
    .select("id,user_id,title,category,subcategory,main_color");
  if (itemErr) throw new Error(`服の取得に失敗 (${email}): ${itemErr.message}`);

  const { data: images, error: imgErr } = await supabase
    .from("clothing_images")
    .select("clothing_item_id,image_path,sort_order")
    .in("clothing_item_id", (items ?? []).map((i) => i.id))
    .order("sort_order", { ascending: true });
  if (imgErr) throw new Error(`画像の取得に失敗 (${email}): ${imgErr.message}`);
  const firstImage = new Map<string, string>();
  for (const img of images ?? []) {
    if (!firstImage.has(img.clothing_item_id)) firstImage.set(img.clothing_item_id, img.image_path);
  }

  for (const item of items ?? []) {
    const imagePath = firstImage.get(item.id);
    if (!imagePath) {
      skippedNoImage++;
      continue;
    }
    const file = `${item.id}.jpg`;
    const dest = path.join(flatsDir, file);
    const exists = await stat(dest).then(() => true, () => false);
    if (!exists) {
      const { data, error } = await supabase.storage.from("clothing-images").download(imagePath);
      if (error || !data) {
        console.error(`ダウンロード失敗 ${item.id}: ${error?.message ?? "no data"}`);
        continue;
      }
      await writeFile(dest, Buffer.from(await data.arrayBuffer()));
      downloaded++;
    }
    bytes += (await readFile(dest)).length;
    manifest.push({
      id: item.id,
      ownerEmail: email,
      title: item.title,
      category: item.category,
      subcategory: item.subcategory,
      main_color: item.main_color,
      file,
    });
  }
  await supabase.auth.signOut();
}

await writeFile(path.join(flatsDir, "items.json"), JSON.stringify(manifest, null, 2));
console.log(`服 ${manifest.length} 件（今回ダウンロード ${downloaded} 件、画像なしで除外 ${skippedNoImage} 件）、合計 ${(bytes / 1024 / 1024).toFixed(1)} MB`);
