// 平置きの写真を本番から取ってくる（読むだけ。書き込みはしない）。
//
// 実行方法:
//   node --env-file=.env.local scripts/similarity-trial/fetch-flats.mts --email a@example.com [--email b@example.com] [--data-dir <dir>]
//
// 鍵の値は出力しない。既にあるファイルは取り直さない（Egress の節約）。

import { createClient } from "@supabase/supabase-js";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
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
const key = process.env.SUPABASE_SECRET_KEY;
if (!url || !key) {
  console.error("NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY が未設定です（--env-file=.env.local で実行）");
  process.exit(1);
}

const flatsDir = path.join(values["data-dir"]!, "flats");
await mkdir(flatsDir, { recursive: true });
const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

// メール → ユーザー ID（auth admin）
const { data: userList, error: userErr } = await supabase.auth.admin.listUsers({ perPage: 1000 });
if (userErr) throw new Error(`ユーザー一覧の取得に失敗: ${userErr.message}`);
const owners = new Map<string, string>(); // user_id -> email
for (const email of emails) {
  const u = userList.users.find((x) => x.email?.toLowerCase() === email.toLowerCase());
  if (!u) throw new Error(`ユーザーが見つかりません: ${email}`);
  owners.set(u.id, email);
}

const { data: items, error: itemErr } = await supabase
  .from("clothing_items")
  .select("id,user_id,title,category,subcategory,main_color")
  .in("user_id", [...owners.keys()]);
if (itemErr) throw new Error(`服の取得に失敗: ${itemErr.message}`);

const { data: images, error: imgErr } = await supabase
  .from("clothing_images")
  .select("clothing_item_id,image_path,sort_order")
  .in("clothing_item_id", (items ?? []).map((i) => i.id))
  .order("sort_order", { ascending: true });
if (imgErr) throw new Error(`画像の取得に失敗: ${imgErr.message}`);
const firstImage = new Map<string, string>();
for (const img of images ?? []) {
  if (!firstImage.has(img.clothing_item_id)) firstImage.set(img.clothing_item_id, img.image_path);
}

const manifest: Record<string, unknown>[] = [];
let bytes = 0;
let downloaded = 0;
let skippedNoImage = 0;
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
    ownerEmail: owners.get(item.user_id),
    title: item.title,
    category: item.category,
    subcategory: item.subcategory,
    main_color: item.main_color,
    file,
  });
}
await writeFile(path.join(flatsDir, "items.json"), JSON.stringify(manifest, null, 2));
console.log(`服 ${manifest.length} 件（今回ダウンロード ${downloaded} 件、画像なしで除外 ${skippedNoImage} 件）、合計 ${(bytes / 1024 / 1024).toFixed(1)} MB`);
