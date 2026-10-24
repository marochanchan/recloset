# 着画 Plan 1：土台と細い1本の流れ Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cloudflare（Images・Stream）との本番連携を最初に確かめる。そのうえで、「写真1枚を送る → 手持ちの服を選ぶ → 確定 → 関係DB → 服の詳細に線で表示」の1本の流れを、DB の正しさ（RPC・権限・送り直し・同時実行）とあわせて通す。

**Architecture:** 事実（`outfits`・`outfit_items`・`wear_logs`）と月ごとのサマリーを Postgres に置き、すべての書き込みを `security definer` の RPC に集める。RPC はユーザーごとのロックをかけ、変更があった月だけを作り直す。写真と動画は、ブラウザから Cloudflare に直接送る。Cloudflare の ID はサーバーが受け取って DB に保存し、表示用の URL もサーバーが署名して作る。Cloudflare とのやりとりは `MediaStore` という1つの部品にまとめ、テストではダミーに差し替える。

**Tech Stack:** Next.js（`node_modules/next/dist/docs/` を必ず読む）、Supabase（Postgres 15、RLS、`@supabase/supabase-js`）、Cloudflare Images・Stream（REST API、`fetch`）、Node 24 の `node:test` と `node:crypto`。新しい npm パッケージは入れない。

**Spec:** `docs/superpowers/specs/2026-10-24-chakuga-outfit-relations-design.md`（6章・7.3〜7.4章・8章・10〜12章が対象）

**後続のプラン:** Plan 2（〜11/5 取り込みの安定）、Plan 3（〜11/9 マップとデモの通し）、Plan 4（11/10以降）。このプランで扱わない仕様の項目は、最後の「仕様との対応」にまとめた。

## Global Constraints

- 日付の区切りはすべて日本時間（`Asia/Tokyo`、UTC+9）。SQL では `(ts at time zone 'Asia/Tokyo')::date`、TS では `lib/wear-logs.ts` の考え方に合わせる。
- 新しいトリガーは作らない。019 の行動履歴のトリガーはそのまま残す。
- SQL の関数は `security definer` ＋ `set search_path = ''`。テーブルと関数は必ず `public.` などのスキーマ付きで書く（019 と同じ）。
- マイグレーションは `begin;` 〜 `commit;` で包む（016〜019 と同じ）。
- RPC は2種類ある（仕様書 6.2 章）。
  - ユーザー向け：ユーザーを `auth.uid()` から決め、`execute` は `authenticated` にだけ許可する。
  - サーバー専用：持ち主を保存済みの行から導く。行がまだないときだけ `p_user_id` を受け取る。`execute` は `service_role` にだけ許可する。
  - 内部用の関数：どのロールにも許可しない。
- どの関数も、作ったのと同じトランザクションで `revoke all on function ... from public, anon, authenticated` してから `grant` する。PostgreSQL は新しい関数を誰でも（`PUBLIC`）実行できるため。
- 着用記録の `worn_at`：今日（日本時間）なら `now()`、過去の日付なら、その日の 12:00（日本時間）。
- `wear_count` と `last_worn_at` は、残っている着用記録から計算し直す（件数と最新の `worn_at`）。
- 本番の Supabase では、`service_role` に既存のテーブル（`clothing_items` など）の権限が付いていない（2026-10-25 に読み取り専用の確認で `permission denied for table clothing_items` を確認）。サーバー専用の処理は RPC（`security definer`）か、このプランで `service_role` に権限を付ける新しいテーブルだけを使い、既存のテーブルを `service_role` で直接読まない。
- Cloudflare の ID はクライアントから受け取らない。署名付き URL の期限は1時間。アップロード URL の期限は30分。
- 着画の写真は、長辺2560px・JPEG・品質0.9 に縮小してから送る。
- Images のバリアントは `thumb`（長辺480px）、`display`（長辺1600px）、`analysis`（長辺2048px）の3つ。どれも `neverRequireSignedURLs` を付けない。
- Stream の動画は `requireSignedURLs: true`、アップロードの長さの上限は `maxDurationSeconds: 60`。
- webhook：`Webhook-Signature: time=<unix秒>,sig1=<hex>`。`${time}.${生の本文}` の HMAC-SHA256 を定数時間で比べる。時刻のずれが300秒より大きいものは拒否する。
- 削除待ちの再試行の間隔：1回目の失敗のあと1分、2回目10分、3回目1時間、4回目以降1日。10回失敗したら止める。
- TS のテストは `node --test` で動かす。`lib/` の中のテストされるファイルは、Node の型の除去（type stripping）で動く書き方だけにする（enum・namespace・コンストラクターの引数のプロパティは使わない）。`@/` の解決は `scripts/test-re-quest.mts` と同じ `registerHooks` を使う。
- DB のテストは Docker の Postgres 15 を使う（`supabase/tests/run-019.sh` と同じ仕組み）。本番の DB には絶対につながない。
- 画面の言葉は今のアプリに合わせ、責めない言い方にする。コメントは日本語で、まわりのコードと同じくらいの量にする。
- 各タスクが終わったら、差分を Codex（Herdr のペイン `w4:p2`、Astra モデル）にレビューしてもらい、指摘に対応してから次へ進む。

## Review Focus

1. **応答だけが失われたアップロード**：Cloudflare には届いたのに、ブラウザが完了を知らせる前に通信が切れる。そのあと「もう一度送る」を押したら、新しい試行を作らずに、届いている実体を使うこと（Task 8 にテストを追加）。
2. **「確定」の二度押しと、2つのタブ**：同じコーデを同じ内容で2回確定しても、版番号は1回だけ増え、着用記録も1件だけになること（Task 6 にテストを追加）。
3. **選んだ服が別のタブで削除済み**：確定のときに存在しない服や、他人の服の ID が混ざっていたら、何も書き込まずにエラーを返すこと。画面は「選んだ服が見つかりませんでした」と出すこと（Task 6 にテストを追加）。
4. **知らない動画の webhook**：テスト用の動画や、もう消えたメディアの通知が届いても 200 を返し、何も変えないこと（Task 9 にテストを追加）。
5. **夜中0時台の記録**：日本時間の 0:30 に記録したら、日付の初期値は日本時間の今日になること。UTC の前日にならないこと（Task 11 にテストを追加）。

---

## File Structure

| ファイル | 役割 |
|---|---|
| `supabase/migrations/020_create_outfit_schema.sql` | 新しいテーブル、既存テーブルの列、制約、RLS、読み取りの権限 |
| `supabase/migrations/021_outfit_stats_functions.sql` | 内部の関数：ロック、日付、派生値の計算し直し、サマリーの作り直し |
| `supabase/migrations/022_outfit_rpcs.sql` | コーデの RPC：下書き、確定・編集、削除、今日着た、服の完全な削除 |
| `supabase/migrations/023_outfit_media_rpcs.sql` | メディアの RPC（サーバー専用）と削除待ち |
| `supabase/migrations/024_tighten_wear_writes.sql` | 書き込み権限の締め付けと初期集計 |
| `supabase/tests/run-outfits.sh` | 020〜024 の DB テストをまとめて動かす（同時実行のテストを含む） |
| `supabase/tests/020_before_setup.sql` | 020 より前の既存データ（服と着用記録） |
| `supabase/tests/02x_*.test.sql` | 各マイグレーションのテスト |
| `lib/media/cloudflare-config.ts` | 環境変数の読み込み |
| `lib/media/cloudflare-signing.ts` | 署名（Images の URL、Stream のトークン、webhook の確認）。純粋な関数 |
| `lib/media/cloudflare-api.ts` | Cloudflare REST API の薄いラッパー（`fetch` を差し替えられる） |
| `lib/media/media-store.ts` | `MediaStore` の型と Cloudflare 版の実装 |
| `lib/media/fake-media-store.ts` | テスト用のダミー |
| `lib/media/stream-webhook.ts` | webhook の処理（ルートから呼ぶ） |
| `lib/media/deletion-queue.ts` | 削除待ちの処理 |
| `lib/outfits/media-service.ts` | アップロードの開始・完了・送り直し（DB と MediaStore を受け取る） |
| `lib/outfits/media-db.ts` | `media-service` が使う DB 操作の Supabase 版 |
| `lib/outfits/relations.ts` | 2着の関係の集計と、線の配置。純粋な関数 |
| `lib/outfits/dates.ts` | 日本時間の今日の日付（`YYYY-MM-DD`） |
| `lib/supabase/admin.ts` | `service_role` のクライアント（サーバー専用） |
| `app/(main)/protected/looks/actions.ts` | Server Actions：アップロード、確定 |
| `app/(main)/protected/looks/new/page.tsx` | 細い流れの記録画面 |
| `app/(main)/protected/looks/[id]/page.tsx` | コーデの表示 |
| `components/outfit-quick-record-form.tsx` | 記録画面のフォーム（クライアント） |
| `components/outfit-item-picker.tsx` | 手持ちの服を選ぶ |
| `components/relation-lines.tsx` | 服の詳細の「よく合わせる服」の線 |
| `app/api/webhooks/cloudflare-stream/route.ts` | Stream の webhook |
| `app/api/cron/media-deletions/route.ts` | 削除待ちの定期処理 |
| `vercel.json` | Cron の設定 |
| `scripts/setup-cloudflare.mts`・`scripts/smoke-cloudflare.mts` | Cloudflare の初期設定と、本番相当の確認（手動） |
| `scripts/test-*.mts` | TS のテスト |

---

### Task 1: Cloudflare の署名（純粋な関数）と下準備

**Files:**
- Modify: `.gitignore`（`.superpowers/` を足す）
- Modify: `.env.example`（下の環境変数を足す）
- Modify: `package.json`（`"test:outfits": "node --test 'scripts/test-cloudflare-*.mts'"`。Task 3 で `'scripts/test-media-*.mts'`、Task 8 で `'scripts/test-outfit-*.mts'` を足す。まだファイルのないパターンは入れない）
- Create: `lib/media/cloudflare-config.ts`
- Create: `lib/media/cloudflare-signing.ts`
- Test: `scripts/test-cloudflare-signing.mts`

**Interfaces:**
- Produces:
  - `type CloudflareConfig = { accountId: string; apiToken: string; imagesAccountHash: string; imagesSigningKey: string; streamCustomerCode: string; streamSigningKeyId: string; streamSigningJwk: string; streamWebhookSecret: string }`
  - `readCloudflareConfig(env?: Record<string, string | undefined>): CloudflareConfig`
  - `signImagesDeliveryUrl(input: { accountHash: string; imageId: string; variant: "thumb" | "display" | "analysis"; signingKey: string; expiresAt: Date }): string`
  - `createStreamToken(input: { videoUid: string; keyId: string; jwkBase64: string; expiresAt: Date; now: Date }): string`
  - `buildStreamUrls(input: { customerCode: string; token: string }): { manifestUrl: string; thumbnailUrl: string; previewGifUrl: string }`
  - `verifyStreamWebhookSignature(input: { header: string | null; rawBody: string; secret: string; now: Date; toleranceSec?: number }): { ok: true } | { ok: false; reason: "missing" | "malformed" | "expired" | "mismatch" }`

環境変数：`SUPABASE_SECRET_KEY`、`CLOUDFLARE_ACCOUNT_ID`、`CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_IMAGES_ACCOUNT_HASH`、`CLOUDFLARE_IMAGES_SIGNING_KEY`、`CLOUDFLARE_STREAM_CUSTOMER_CODE`、`CLOUDFLARE_STREAM_SIGNING_KEY_ID`、`CLOUDFLARE_STREAM_SIGNING_JWK`、`CLOUDFLARE_STREAM_WEBHOOK_SECRET`、`CRON_SECRET`。

- [ ] **Step 1: 失敗するテストを書く**（`scripts/test-cloudflare-signing.mts`。冒頭の `registerHooks` は `scripts/test-re-quest.mts` と同じ）

```ts
test("Images の署名付き URL は path?exp の HMAC-SHA256 を sig に付ける", () => {
  const url = new URL(signImagesDeliveryUrl({ accountHash: "hash123", imageId: "img1", variant: "thumb", signingKey: "test-key", expiresAt: new Date(1_700_000_000_000) }));
  assert.equal(url.origin + url.pathname, "https://imagedelivery.net/hash123/img1/thumb");
  assert.equal(url.searchParams.get("exp"), "1700000000");
  const expected = createHmac("sha256", "test-key").update("/hash123/img1/thumb?exp=1700000000").digest("hex");
  assert.equal(url.searchParams.get("sig"), expected);
});
test("Stream のトークンは kid 付きの RS256 で、公開鍵で検証できる", () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const jwkBase64 = Buffer.from(JSON.stringify(privateKey.export({ format: "jwk" }))).toString("base64");
  const token = createStreamToken({ videoUid: "vid1", keyId: "kid1", jwkBase64, expiresAt: new Date(1_700_003_600_000), now: new Date(1_700_000_000_000) });
  const [h, p, s] = token.split(".");
  assert.deepEqual(JSON.parse(Buffer.from(h, "base64url").toString()), { alg: "RS256", kid: "kid1" });
  const payload = JSON.parse(Buffer.from(p, "base64url").toString());
  assert.equal(payload.sub, "vid1"); assert.equal(payload.kid, "kid1"); assert.equal(payload.exp, 1_700_003_600);
  assert.equal(payload.nbf, 1_700_000_000 - 60);
  assert.ok(createVerify("RSA-SHA256").update(`${h}.${p}`).verify(publicKey, Buffer.from(s, "base64url")));
});
test("Stream の URL は customer コードとトークンから作る", () => {
  const u = buildStreamUrls({ customerCode: "abc", token: "TKN" });
  assert.equal(u.manifestUrl, "https://customer-abc.cloudflarestream.com/TKN/manifest/video.m3u8");
  assert.equal(u.thumbnailUrl, "https://customer-abc.cloudflarestream.com/TKN/thumbnails/thumbnail.jpg?time=1s");
  assert.equal(u.previewGifUrl, "https://customer-abc.cloudflarestream.com/TKN/thumbnails/thumbnail.gif?time=0s&duration=3s");
});
// webhook: secret "whsec"、本文 '{"uid":"v1"}'、time=1700000000、now=1700000100
// sig1 = HMAC-SHA256("whsec", "1700000000.{\"uid\":\"v1\"}") の hex
test("webhook：正しい署名は ok");                          // → { ok: true }
test("webhook：本文が1文字違うと mismatch");                 // rawBody '{"uid":"v2"}' → mismatch
test("webhook：秘密が違うと mismatch");
test("webhook：301秒より古いと expired");                    // now = 1700000301 → expired（300 ちょうどは ok）
test("webhook：ヘッダーがないと missing、形が違うと malformed"); // null → missing、"sig1=abc" → malformed
test("設定：足りない環境変数の名前をすべて挙げて例外にする");     // readCloudflareConfig({}) の message に CLOUDFLARE_ACCOUNT_ID と CLOUDFLARE_STREAM_WEBHOOK_SECRET を含む
```

- [ ] **Step 2: テストが失敗することを確かめる**

Run: `node --test scripts/test-cloudflare-signing.mts`
Expected: FAIL（`lib/media/cloudflare-signing.ts` が見つからない）

- [ ] **Step 3: `lib/media/cloudflare-config.ts` と `lib/media/cloudflare-signing.ts` を実装する**

`node:crypto` の `createHmac`、`createPrivateKey({ key: jwk, format: "jwk" })`、`createSign("RSA-SHA256")`、`timingSafeEqual` を使う。JWT の各部分は base64url。webhook の比較は、長さが違えば `timingSafeEqual` を呼ばずに mismatch にする。

- [ ] **Step 4: テストが通ることを確かめる**

Run: `node --test scripts/test-cloudflare-signing.mts`
Expected: PASS（9 tests）

- [ ] **Step 5: `.gitignore`、`.env.example`、`package.json` を直してコミットする**

```bash
git add .gitignore .env.example package.json lib/media/cloudflare-config.ts lib/media/cloudflare-signing.ts scripts/test-cloudflare-signing.mts
git commit -m "feat: add Cloudflare signing helpers for outfit media"
```

---

### Task 2: Cloudflare API のラッパーと MediaStore

**Files:**
- Create: `lib/media/cloudflare-api.ts`
- Create: `lib/media/media-store.ts`
- Create: `lib/media/fake-media-store.ts`
- Test: `scripts/test-cloudflare-api.mts`

**Interfaces:**
- Consumes: Task 1 の `CloudflareConfig`、`signImagesDeliveryUrl`、`createStreamToken`、`buildStreamUrls`
- Produces:
  - `type MediaProvider = "cf_images" | "cf_stream"`
  - `type AssetState = { state: "missing" | "awaiting_upload" | "processing" | "ready" | "failed"; width?: number; height?: number; durationSec?: number }`
  - `interface MediaStore { createUpload(input: { kind: "photo" | "video"; userId: string; mediaId: string; expiresAt: Date }): Promise<{ provider: MediaProvider; assetId: string; uploadUrl: string }>; getAssetState(provider: MediaProvider, assetId: string): Promise<AssetState>; deleteAsset(provider: MediaProvider, assetId: string): Promise<"deleted" | "not_found">; signedImageUrl(assetId: string, variant: "thumb" | "display" | "analysis", now: Date): string; signedStreamUrls(assetId: string, now: Date): { manifestUrl: string; thumbnailUrl: string; previewGifUrl: string } }`
  - `createCloudflareApi(config: CloudflareConfig, fetchImpl?: typeof fetch)`（下の6つの関数を持つオブジェクト）
  - `createCloudflareMediaStore(config: CloudflareConfig, api: ReturnType<typeof createCloudflareApi>): MediaStore`
  - `createFakeMediaStore(): MediaStore & { assets: Map<string, AssetState & { provider: MediaProvider }>; setState(assetId: string, s: AssetState): void; failNextDelete(error: Error): void }`
  - `class CloudflareApiError extends Error { status: number }`（フィールドはクラス本体で宣言する）

API の呼び先（`https://api.cloudflare.com/client/v4/accounts/{accountId}` の下、`Authorization: Bearer {apiToken}`）：

| 関数 | メソッドとパス | 送るもの | 返すもの |
|---|---|---|---|
| `createImageUpload({ metadata, expiresAt })` | `POST /images/v2/direct_upload`（multipart） | `requireSignedURLs=true`、`metadata=JSON`、`expiry=ISO` | `{ id, uploadURL }` |
| `getImage(id)` | `GET /images/v1/{id}` | ― | `{ draft: boolean; variants: string[] }`。404 なら `null` |
| `deleteImage(id)` | `DELETE /images/v1/{id}` | ― | 404 なら `"not_found"` |
| `createStreamUpload({ meta, expiresAt })` | `POST /stream/direct_upload`（JSON） | `{ maxDurationSeconds: 60, requireSignedURLs: true, meta, expiry }` | `{ uid, uploadURL }` |
| `getStreamVideo(uid)` | `GET /stream/{uid}` | ― | `{ state, readyToStream, width, height, duration, preview }`。404 なら `null` |
| `deleteStreamVideo(uid)` | `DELETE /stream/{uid}` | ― | 404 なら `"not_found"` |

状態の対応：Images は `null` → missing、`draft: true` → awaiting_upload、それ以外 → ready。Stream は `null` → missing、`pendingupload` → awaiting_upload、`downloading`・`queued`・`inprogress` → processing、`ready`（`readyToStream`）→ ready、`error` → failed。

- [ ] **Step 1: 失敗するテストを書く**（`fetchImpl` に、呼ばれた URL・メソッド・本文を記録して決まった JSON を返すダミーを渡す）

```ts
test("写真のアップロード URL：direct_upload に requireSignedURLs と metadata と expiry を送る", async () => {
  // 返り値 { provider: "cf_images", assetId: "img-1", uploadUrl: "https://upload.example/img-1" }
  // 送った FormData の requireSignedURLs === "true"、JSON.parse(metadata) が { userId: "u1", mediaId: "m1" }、expiry === "2026-10-25T00:30:00.000Z"
});
test("動画のアップロード URL：maxDurationSeconds 60、requireSignedURLs true、meta に userId と mediaId");
test("getAssetState：Images の draft は awaiting_upload、draft なしは ready、404 は missing");
test("getAssetState：Stream の pendingupload/inprogress/ready/error/404 を対応する状態にし、ready では width・height・durationSec を返す");
test("deleteAsset：404 は not_found、200 は deleted、500 は CloudflareApiError（status 500）");
test("signedImageUrl：期限は now の1時間後で、imagedelivery.net の URL になる");   // exp === Math.floor(now/1000) + 3600
test("signedStreamUrls：トークンの exp は now の1時間後");
test("ダミー：createUpload で awaiting_upload の資産ができ、setState と failNextDelete が効く");
```

- [ ] **Step 2: テストが失敗することを確かめる**

Run: `node --test scripts/test-cloudflare-api.mts`
Expected: FAIL（モジュールがない）

- [ ] **Step 3: `lib/media/cloudflare-api.ts`、`lib/media/media-store.ts`、`lib/media/fake-media-store.ts` を実装する**

Cloudflare の応答は `{ success, errors, result }`。`success: false` か 2xx 以外（404 を除く）は `CloudflareApiError`。

- [ ] **Step 4: テストが通ることを確かめる**

Run: `node --test scripts/test-cloudflare-api.mts`
Expected: PASS（8 tests）

- [ ] **Step 5: コミットする**

```bash
git add lib/media/cloudflare-api.ts lib/media/media-store.ts lib/media/fake-media-store.ts scripts/test-cloudflare-api.mts
git commit -m "feat: add Cloudflare API wrapper and MediaStore"
```

---

### Task 3: Stream の webhook（署名の確認まで）と、Cloudflare の本番相当の確認（10/26 の到達点）

**Files:**
- Create: `lib/media/stream-webhook.ts`
- Create: `app/api/webhooks/cloudflare-stream/route.ts`
- Modify: `lib/supabase/proxy.ts`（`/api/webhooks/` と `/api/cron/` は、ログインへの転送の対象外にする。先にファイルを読み、今の除外のしかたに合わせる）
- Modify: `package.json`（`test:outfits` に `'scripts/test-media-*.mts'` を足す）
- Create: `scripts/setup-cloudflare.mts`
- Create: `scripts/smoke-cloudflare.mts`
- Modify: `docs/project/TODO.md`（結果を記録する）
- Test: `scripts/test-media-stream-webhook.mts`

**Interfaces:**
- Consumes: Task 1・2 の `readCloudflareConfig`、`verifyStreamWebhookSignature`、`createCloudflareApi`、`createCloudflareMediaStore`、`analyzeClothingImage`（`lib/clothing-image-analysis.ts`）
- Produces:
  - `handleStreamWebhook(input: { header: string | null; rawBody: string; secret: string; now: Date; apply: (p: { assetId: string; state: string; width: number | null; height: number | null; durationSec: number | null }) => Promise<"applied" | "ignored" | "duplicate"> }): Promise<{ status: 200 | 400 | 401; result?: string }>`
    - 署名が通らなければ 401。
    - 本文の JSON が読めない、または `uid` がなければ 400。
    - それ以外は `apply` の結果と 200。
    - 本文から読むもの：`uid`、`status.state`、`input.width`、`input.height`、`duration`。
  - ルート：`request.text()` で生の本文を読み、`handleStreamWebhook` を呼ぶ。このタスクでは、`apply` は「uid と state を `console.info` に出して `"ignored"` を返す」仮のものにする（DB は Task 9 でつなぐ）。Next.js のルートの書き方は、先に `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md` を読んで合わせる。

**ユーザーにお願いすること（このタスクの前に）：**
- Cloudflare の Images と Stream の有料プランを有効にする。
- API トークンを作る（Account の Cloudflare Images: Edit と Stream: Edit）。
- `CLOUDFLARE_ACCOUNT_ID`、`CLOUDFLARE_API_TOKEN` を `.env.local` に入れる。
- 5秒ほどの短い MP4 を1本と、服が写った写真（JPEG）を1枚用意する。

- [ ] **Step 1: webhook の失敗するテストを書く**（`scripts/test-media-stream-webhook.mts`）

```ts
test("正しい署名：apply を呼び、200 と結果を返す");
test("署名が違う：401 で、apply を呼ばない");
test("知らない uid（apply が ignored）：200 で ignored");                       // ← Review Focus 4
test("同じ通知の2回目（apply が duplicate）：200");
test("本文が JSON でない：400");
```

- [ ] **Step 2: テストが失敗することを確かめる**

Run: `node --test scripts/test-media-stream-webhook.mts`
Expected: FAIL（モジュールがない）

- [ ] **Step 3: `stream-webhook.ts`、ルート（仮の `apply`）、`proxy.ts` を実装し、テストを通す**

Run: `node --test scripts/test-media-stream-webhook.mts && npm run lint && npm run build`
Expected: PASS（5 tests）、lint と build はエラーなし

- [ ] **Step 4: `scripts/setup-cloudflare.mts` を書く**（何度実行しても同じ結果になる）
  - **秘密の値は画面に出さない。** 鍵や秘密は `.env.local` の該当する行を書き換える（なければ足す）だけにして、画面には「書き込みました：変数名」とだけ出す。トークンや鍵をログ・例外のメッセージにも含めない。
  - `--check`（読むだけ。Cloudflare の設定は何も変えない）：
    - `GET /images/v1/stats` の上限と今の枚数を表示する。
    - `GET /stream/storage-usage` の保存できる分数と今の分数を表示する。
    - 今あるバリアントと、その `neverRequireSignedURLs` を表示する。
  - 引数なし（設定する）：
  1. バリアント `thumb`（480）・`display`（1600）・`analysis`（2048）を、`fit: "scale-down"`、`metadata: "none"`、`neverRequireSignedURLs: false` で作る。すでにあれば、`neverRequireSignedURLs` が true なら false に直す（`PATCH /images/v1/variants/{id}`）。
  2. 全バリアントを読み直し、`neverRequireSignedURLs` が1つでも true なら終了コード1。
  3. `GET /images/v1/keys` で署名の鍵を取り出し、`.env.local` の `CLOUDFLARE_IMAGES_SIGNING_KEY` に書き込む。
  4. 引数 `--stream-key` のときだけ、`POST /stream/keys` で署名の鍵を作り、`CLOUDFLARE_STREAM_SIGNING_KEY_ID` と `CLOUDFLARE_STREAM_SIGNING_JWK` に書き込む（毎回作らない）。
  5. 引数 `--webhook <URL>` のときだけ、`PUT /stream/webhook` で通知先を登録し、`CLOUDFLARE_STREAM_WEBHOOK_SECRET` に書き込む。
  - Vercel に入れる値は、ユーザーが `.env.local` を開いてコピーする（Claude は `.env.local` の中身を読まない）。

- [ ] **Step 5: `scripts/smoke-cloudflare.mts` を書く**（引数：服の写真の JPEG のパスと、MP4 のパス。どの段階が失敗したかを表示して、終了コード1で止まる）
  1. 写真：`createUpload("photo")` → 渡された JPEG を `uploadUrl` に POST → `getAssetState` が ready。
  2. `CLOUDFLARE_IMAGES_ACCOUNT_HASH` がまだなければ、`getImage` の応答の `variants` の URL（`https://imagedelivery.net/<hash>/<id>/<variant>`）から取り出して使い、`.env.local` に書き込む（秘密ではないが、書き方をそろえる）。そのため Task 2 の `getImage` は `{ draft: boolean; variants: string[] }` を返す。
  3. 署名なしの `https://imagedelivery.net/{hash}/{id}/thumb` が 200 でない。3つのバリアントの署名付き URL が、どれも 200。
  4. AI の入力：`analysis` の署名付き URL の中身を `analyzeClothingImage()` に渡し、結果の `category` を表示する。
  5. 動画：`createUpload("video")` → MP4 を POST → ready になるまで5秒ごとに確かめる（最大3分）。`CLOUDFLARE_STREAM_CUSTOMER_CODE` がまだなければ、動画の応答の `preview` の URL（`https://customer-<CODE>.cloudflarestream.com/...`）から取り出して使い、`.env.local` に書き込む（そのため `getStreamVideo` は `preview` も返す）。署名なしの manifest とサムネイルが 200 でない。署名付きは 200。
  6. 後片付け：写真と動画を `deleteAsset` → 両方とも `getAssetState` が missing。

- [ ] **Step 6: 動かす**

Run: `node --env-file=.env.local scripts/setup-cloudflare.mts --check`（読むだけ。上限と今の量を確かめる）
Run: `node --env-file=.env.local scripts/setup-cloudflare.mts --stream-key`（鍵は `.env.local` に書き込まれ、画面には出ない）
Run: `node --env-file=.env.local scripts/smoke-cloudflare.mts ~/Desktop/test-outfit.jpg ~/Desktop/test.mp4`
Expected: すべての段階が `ok:` で、終了コード0

- [ ] **Step 7: webhook を本番相当で確かめる**
  1. ブランチをプッシュし、Vercel のプレビューに `CLOUDFLARE_STREAM_WEBHOOK_SECRET` 以外の環境変数を入れてデプロイする。
  2. `node --env-file=.env.local scripts/setup-cloudflare.mts --webhook https://<プレビューのドメイン>/api/webhooks/cloudflare-stream` を実行する（秘密は `.env.local` に書き込まれる）。ユーザーがその値を Vercel に入れて、もう一度デプロイする。
  3. smoke をもう一度動かし、Vercel のログに仮の `apply` の出力（uid と state）が出て、応答が 200 であることを確かめる。

- [ ] **Step 8: TODO に結果を記録してコミットする**

```bash
git add lib/media/stream-webhook.ts app/api/webhooks lib/supabase/proxy.ts package.json scripts/test-media-stream-webhook.mts scripts/setup-cloudflare.mts scripts/smoke-cloudflare.mts docs/project/TODO.md
git commit -m "feat: add Stream webhook verification route and Cloudflare smoke scripts"
```

---

### Task 4: DB スキーマ（020）と DB テストの仕組み

**Files:**
- Create: `supabase/migrations/020_create_outfit_schema.sql`
- Create: `supabase/tests/run-outfits.sh`
- Create: `supabase/tests/020_before_setup.sql`
- Test: `supabase/tests/020_outfit_schema.test.sql`

**Interfaces:**
- Produces（テーブル。列の意味は仕様書 6.1 章。Plan 2 で `outfit_analysis_runs`・`outfit_detections`、Plan 4 で `item_groups`・`item_group_members` を足す）：
  - `clothing_items`：`archived_at timestamptz`、制約 `unique (id, user_id)`、`check (archived_at is null or not is_public)`
  - `wear_logs`：`source text not null default 'wear_today' check (source in ('wear_today','outfit'))`
  - `outfits`：`id, user_id, worn_on date, source, status default 'pending', revision int default 0, client_request_id uuid, analysis_media_id uuid, selected_person_index int, note text, confirmed_at, created_at, updated_at`、`unique (user_id, client_request_id)`、`unique (id, user_id)`
  - `outfit_media`：`id, user_id, outfit_id, kind, provider, provider_asset_id text, upload_attempt int default 1, upload_expires_at, status default 'uploading', width, height, duration_sec numeric, taken_at, sort_order int default 0, created_at, updated_at`。外部キー `(outfit_id, user_id) → outfits(id, user_id) on delete cascade`。`unique (provider, provider_asset_id)`、`unique (id, outfit_id)`
  - `outfits.analysis_media_id`：外部キー `(analysis_media_id, id) → outfit_media(id, outfit_id) on delete set null (analysis_media_id)`
  - `outfit_items`：`outfit_id, item_id, user_id, wear_log_id uuid unique, source default 'manual', detection_id uuid, created_at, updated_at`。主キー `(outfit_id, item_id)`。外部キーは次の3つ。
    - `(outfit_id, user_id) → outfits on delete cascade`
    - `(item_id, user_id) → clothing_items(id, user_id) on delete restrict`
    - `wear_log_id → wear_logs on delete set null`
  - `item_monthly_stats(user_id, item_id, month, wear_log_count, worn_days, outfit_count, last_worn_on, updated_at)`。主キー `(user_id, item_id, month)`
  - `item_pair_monthly_stats(user_id, item_a, item_b, month, outfit_count, together_days, last_worn_on, updated_at)`。主キー `(user_id, item_a, item_b, month)`、`check (item_a < item_b)`
  - `outfit_combo_monthly_stats(user_id, combo_key text, item_ids uuid[], month, outfit_count, last_worn_on, updated_at)`。主キー `(user_id, combo_key, month)`
  - `media_deletion_queue(id, user_id uuid（外部キーなし）, provider, provider_asset_id, attempts int default 0, next_attempt_at default now(), claim_token uuid, lease_until timestamptz, last_error, done_at, created_at, updated_at)`。`unique (provider, provider_asset_id)`

決めごと：
- サマリーは事実から作り直せる派生データで、同期の対象ではないので、主キーは複合キーにする。`month` には `check (extract(day from month) = 1)` を付ける。服への外部キーは `(item_id, user_id) → clothing_items(id, user_id) on delete cascade`。
- RLS は、全テーブルで `user_id = (select auth.uid())` の select ポリシーだけを作る。
- `authenticated` には select だけ許可する（キューには何も許可しない）。`service_role` には select・insert・update・delete を許可する。
- インデックス：`outfits (user_id, worn_on desc)`、`outfit_items (user_id, item_id)`、`outfit_media (outfit_id, sort_order)`、`media_deletion_queue (next_attempt_at) where done_at is null`。

- [ ] **Step 1: `run-outfits.sh` を書く**
  - `run-019.sh` をもとにする：stub → 001〜019 → `020_before_setup.sql` → `supabase/migrations/02[0-9]_*.sql` のうち存在するものを番号順に適用 → `supabase/tests/02[0-9]_*.test.sql` を順に `run_test`。
  - 020 については、019 と同じ「commit の直前でわざと失敗させても何も残らない」確認を入れる。
  - `020_before_setup.sql` に入れる既存データ：ユーザー A（服3着、着用記録5件。2026-09 と 2026-10 にまたがり、日本時間の深夜 0:30 の記録を1件含める）とユーザー B（服1着、着用記録1件）。

- [ ] **Step 2: 失敗するテストを書く**（`020_outfit_schema.test.sql`。`test.assert` は 019 のテストと同じ。操作は `set local role authenticated` と `set_config('request.jwt.claim.sub', ..., true)` で行う）

```sql
-- ok: 既存の着用記録の source はすべて wear_today
-- ok: A は自分の outfits を読めるが、B の outfits は0件しか見えない（outfit_media・outfit_items・サマリー3つも同じ）
-- ok: authenticated は outfits / outfit_items / outfit_media / サマリーに insert できない（insufficient_privilege）
-- ok: authenticated は media_deletion_queue を select できない
-- ok: B の服を A のコーデの outfit_items に入れる insert（postgres で実行）は外部キーで失敗する
-- ok: コーデに入っている服の delete は restrict で失敗し、コーデに入っていない服の delete は通る
-- ok: 別のコーデのメディアを analysis_media_id にすると外部キーで失敗する
-- ok: メディアを消すと analysis_media_id だけが null になり、outfits.id は残る
-- ok: month が月の1日でないサマリーは check で失敗する
-- ok: archived_at のある服を is_public = true（published_at あり）にすると check で失敗する
```

- [ ] **Step 3: テストが失敗することを確かめる**

Run: `bash supabase/tests/run-outfits.sh`
Expected: FAIL（`020_create_outfit_schema.sql` がない、または `relation "public.outfits" does not exist`）

- [ ] **Step 4: `020_create_outfit_schema.sql` を書く**

- [ ] **Step 5: テストが通ることを確かめる**

Run: `bash supabase/tests/run-outfits.sh`
Expected: すべて `ok:`、終了コード0

- [ ] **Step 6: コミットする**

```bash
git add supabase/migrations/020_create_outfit_schema.sql supabase/tests/run-outfits.sh supabase/tests/020_before_setup.sql supabase/tests/020_outfit_schema.test.sql
git commit -m "feat: add outfit schema with owner-bound foreign keys and RLS"
```

---

### Task 5: サマリーの作り直しと派生値（021）

**Files:**
- Create: `supabase/migrations/021_outfit_stats_functions.sql`
- Test: `supabase/tests/021_outfit_stats.test.sql`

**Interfaces:**
- Produces（すべて内部用。`public, anon, authenticated` から `execute` を取り上げ、`service_role` にだけ許可する）：
  - `public.outfit_lock_user(p_user uuid) returns void`：`pg_advisory_xact_lock(hashtextextended('outfits:' || p_user::text, 0))`
  - `public.jst_date(p_ts timestamptz) returns date`：`(p_ts at time zone 'Asia/Tokyo')::date`（immutable）
  - `public.outfit_worn_at(p_worn_on date) returns timestamptz`：日本時間の今日なら `now()`、それ以外は `(p_worn_on + time '12:00') at time zone 'Asia/Tokyo'`
  - `public.recompute_item_wear(p_item_ids uuid[]) returns void`：`wear_count = count(wear_logs)`、`last_worn_at = max(worn_at)`（記録がなければ 0 と null）
  - `public.rebuild_monthly_stats(p_user uuid, p_month date) returns void`
  - `public.rebuild_all_stats(p_user uuid) returns void`

`rebuild_monthly_stats` の中身（その月の3つのサマリーの行を消してから、事実から入れ直す。範囲は日本時間の `[p_month, p_month + 1 month)`）：
- `item_monthly_stats`：その月の、そのユーザーの服の着用記録から作る。
  - `wear_log_count = count(*)`
  - `worn_days = count(distinct jst_date(worn_at))`
  - `last_worn_on = max(jst_date(worn_at))`
  - `outfit_count` は、その月の確定済みコーデ（`worn_on` で判定）に入った回数。着用記録はないがコーデに入っている服も行を作る。
- `item_pair_monthly_stats`：その月の確定済みコーデの `outfit_items` を同じコーデどうしで組み合わせる（`a.item_id < b.item_id`）。`outfit_count = count(*)`、`together_days = count(distinct worn_on)`、`last_worn_on = max(worn_on)`。
- `outfit_combo_monthly_stats`：服が2着以上の確定済みコーデごとに、次を出して `combo_key` でまとめる。
  - `combo_key = md5(string_agg(item_id::text, ',' order by item_id))`
  - `item_ids = array_agg(item_id order by item_id)`

`rebuild_all_stats`：そのユーザーのサマリーを全部消したあと、次を行う。
1. 着用記録の月と、確定済みコーデの月を重複なく集め、それぞれ `rebuild_monthly_stats` する。
2. そのユーザーの全部の服を `recompute_item_wear` する。

- [ ] **Step 1: 失敗するテストを書く**（`021_outfit_stats.test.sql`。事実は postgres で直接入れ、関数を呼んでから確かめる）

```sql
-- 準備：A の 2026-10 に確定コーデ3件（10/20: T,D,G ／ 10/22: T,D,S ／ 10/23: W,D,G）、確認待ちコーデ1件（10/24: T,W）、
--       コーデの服にはそれぞれ着用記録をひも付け、別に「今日着た」の記録（10/22 の T、もう1件）を入れる
-- ok: T の 2026-10：wear_log_count=3、worn_days=2（10/22 の重複は1日）、outfit_count=2、last_worn_on=2026-10-22
-- ok: (D,T) の組：outfit_count=2、together_days=2、last_worn_on=2026-10-22
-- ok: (D,G) の組：outfit_count=2。確認待ちの (T,W) の組の行はない
-- ok: combo (T,D,G) の outfit_count=1。服が1着のコーデは combo を作らない
-- ok: 10/31 23:30 JST（UTC では 10/31 14:30）の記録は 10月、11/1 0:30 JST（UTC では 10/31 15:30）の記録は 11月に入る
-- ok: 10月の事実をすべて消して作り直すと、10月の行が3つのサマリーすべてで0件になる
-- ok: rebuild_all_stats の結果が、月ごとに作り直した結果と完全に一致する（except で差が0行）
-- ok: recompute_item_wear のあと、wear_count と last_worn_at が着用記録と一致する
-- ok: outfit_worn_at('2026-10-01') = '2026-10-01 03:00:00+00'
-- ok: authenticated から rebuild_monthly_stats を呼ぶと insufficient_privilege
```

- [ ] **Step 2: テストが失敗することを確かめる**

Run: `bash supabase/tests/run-outfits.sh`
Expected: FAIL（`function public.rebuild_monthly_stats(uuid, date) does not exist`）

- [ ] **Step 3: `021_outfit_stats_functions.sql` を書く**

- [ ] **Step 4: テストが通ることを確かめる**

Run: `bash supabase/tests/run-outfits.sh`
Expected: すべて `ok:`

- [ ] **Step 5: コミットする**

```bash
git add supabase/migrations/021_outfit_stats_functions.sql supabase/tests/021_outfit_stats.test.sql
git commit -m "feat: add monthly outfit stats rebuild functions"
```

---

### Task 6: コーデの RPC（022）

**Files:**
- Create: `supabase/migrations/022_outfit_rpcs.sql`
- Modify: `supabase/tests/run-outfits.sh`（同時実行のテストを足す）
- Test: `supabase/tests/022_outfit_rpcs.test.sql`

**Interfaces:**
- Consumes: Task 5 の内部関数
- Produces（`authenticated` に `execute` を許可する。どれも最初に `outfit_lock_user(auth.uid())`。`auth.uid()` が null なら例外）：
  - `public.create_outfit_draft(p_client_request_id uuid, p_worn_on date, p_source text) returns public.outfits`：同じ `(user_id, client_request_id)` があればそれを返す
  - `public.confirm_outfit(p_outfit_id uuid, p_expected_revision integer, p_worn_on date, p_item_ids uuid[], p_note text) returns jsonb`：`{ "status": "confirmed" | "unchanged" | "stale", "revision": int }`
  - `public.delete_outfit(p_outfit_id uuid) returns void`
  - `public.record_wear_today(p_item_id uuid) returns jsonb`：`{ "created": boolean }`
  - `public.hard_delete_item(p_item_id uuid) returns void`
  - `public.enqueue_media_deletion(p_user uuid, p_provider text, p_asset_id text) returns void`（内部用。`on conflict do nothing`。Task 7 も使う）

例外は `raise exception using errcode = 'P0002', message = 'outfit_not_found'` のように、決まった message にする。message は `outfit_not_found`、`item_not_found`、`invalid_revision`、`not_authenticated`。

`confirm_outfit` の手順（仕様書 6.2 章の表のとおり）：

```text
1. ロック → outfits を user で for update 取得（なければ outfit_not_found）
2. p_item_ids を重複なしにする。どれかが本人の服でなければ item_not_found。
   新しく足す服がしまった服（archived_at あり）でも item_not_found
3. 状態が confirmed で、worn_on・服の集合・note が今と同じなら {unchanged, 今の revision} を返す（p_expected_revision は問わない）
4. p_expected_revision < revision なら {stale, revision} を返す。> revision なら invalid_revision
5. 影響する月 = 元の worn_on の月（確定済みのとき）と、新しい worn_on の月
6. 外す服：source=outfit の記録は消す。wear_today の記録は outfit_items の行だけを消す
7. 日付が変わったら、残す服について次を行う
   - source=outfit の記録：worn_at を outfit_worn_at(新しい日付) に直す
   - wear_today の記録：wear_log_id を null にする（記録は残す）
8. 記録がない服（足す服と、7で外した服）について、次のどちらかを行う
   - 同じ日（日本時間）の、どの outfit_items からも参照されていない wear_today の記録を1件使う
   - なければ、source=outfit、worn_at=outfit_worn_at(新しい日付) の記録を作る
9. outfits を更新する
   - status=confirmed、worn_on、note、revision+1、confirmed_at=coalesce(confirmed_at, now())、updated_at=now()
10. recompute_item_wear(元の服 ∪ 新しい服) → 影響する月を rebuild_monthly_stats
11. {confirmed, 新しい revision} を返す
```

その他の RPC：
- `delete_outfit`：本人のコーデかを確かめる。影響する月を集める。source=outfit の記録を消す。メディアを `enqueue_media_deletion` に入れる。コーデを消す（メディアの行と outfit_items は cascade）。そのあと `recompute_item_wear` と、月の作り直しを行う。
- `record_wear_today`：本人のしまっていない服でなければ `item_not_found`。日本時間の今日の記録がすでにあれば `{created:false}`。なければ `source=wear_today`、`worn_at=now()` で作り、派生値と今月を作り直す。
- `hard_delete_item`：影響する月（記録の月と、確定済みコーデの月）を先に集める。`outfit_items` からその服の行を消す。服を消す。月を作り直す。コーデは消さない。

- [ ] **Step 1: 失敗するテストを書く**（`022_outfit_rpcs.test.sql`）

```sql
-- 下書き
-- ok: 同じ client_request_id の create_outfit_draft は同じ id を返し、行は1件
-- 確定
-- ok: 初めての確定は {confirmed, 1}、服ごとに source=outfit の記録が1件、worn_at は 12:00 JST
-- ok: 同じ日の未使用の wear_today の記録があれば、それを使う（記録が増えない）
-- ok: 同じ内容をもう一度（expected 0 でも 1 でも）送ると {unchanged, 1}、記録は増えない         ← Review Focus 2
-- ok: 古い版から別の内容を送ると {stale, 2}、何も変わらない
-- ok: 服を外すと source=outfit の記録は消え、使っていた wear_today の記録は残る
-- ok: 日付を 10/31 → 11/2 に変えると、source=outfit の記録の worn_at が直り、10月と11月の両方のサマリーが変わる
-- ok: 最新の着用を過去の日付に直すと、last_worn_at がほかの記録の最新に戻る
-- ok: B の服を入れると item_not_found で、何も書き込まれない（revision も記録も変わらない）       ← Review Focus 3
-- ok: 存在しない服の id を入れても item_not_found
-- ok: しまった服を新しく足すと item_not_found
-- ok: B のコーデを A が確定しようとすると outfit_not_found
-- 削除と今日着た
-- ok: delete_outfit で source=outfit の記録は消え、wear_today の記録は残る。メディアの asset が削除待ちに入る
-- ok: record_wear_today は1日1回だけ作り、2回目は {created:false}
-- ok: hard_delete_item でコーデは残り、ほかの服の組み合わせのサマリーは残る。消した服の行はサマリーから消える
-- 権限
-- ok: anon は confirm_outfit を呼べない
```

同時実行のテスト（`run-outfits.sh` に足す。2つの psql を同時に動かす）：
- 接続1：`begin;` → A として `record_wear_today(T)` → `pg_sleep(2)` → `commit;`
- 接続2：0.5秒後に開始。A として、T を含む今日のコーデを `confirm_outfit`。
- 終わったら postgres で次を確かめる。
  - T の今日の記録は1件だけ。
  - それがコーデにつながっている。
  - `wear_count` が記録の件数と同じ。
- 表示：`ok: 同時に「今日着た」と確定をしても、記録が二重にならない`

- [ ] **Step 2: テストが失敗することを確かめる**

Run: `bash supabase/tests/run-outfits.sh`
Expected: FAIL（`function public.create_outfit_draft(...) does not exist`）

- [ ] **Step 3: `022_outfit_rpcs.sql` を書く**

- [ ] **Step 4: テストが通ることを確かめる**

Run: `bash supabase/tests/run-outfits.sh`
Expected: すべて `ok:`（同時実行の行を含む）

- [ ] **Step 5: コミットする**

```bash
git add supabase/migrations/022_outfit_rpcs.sql supabase/tests/022_outfit_rpcs.test.sql supabase/tests/run-outfits.sh
git commit -m "feat: add outfit RPCs with revisions, wear-log reuse and per-user locking"
```

---

### Task 7: メディアと削除待ちの RPC（023）

**Files:**
- Create: `supabase/migrations/023_outfit_media_rpcs.sql`
- Test: `supabase/tests/023_outfit_media_rpcs.test.sql`

**Interfaces:**
- Consumes: Task 5・6 の `outfit_lock_user`、`enqueue_media_deletion`
- Produces（すべてサーバー専用。`service_role` にだけ `execute` を許可する）：
  - `public.register_outfit_media(p_user_id uuid, p_media_id uuid, p_outfit_id uuid, p_kind text, p_provider text, p_asset_id text, p_upload_expires_at timestamptz, p_taken_at timestamptz, p_sort_order integer) returns public.outfit_media`
    - コーデが `p_user_id` のものでなければ `outfit_not_found`。
    - 同じ `p_media_id` がすでにあれば、`p_user_id` の行ならそのまま返し、他人の行なら message `media_conflict` の例外にする。
    - 種類が photo で、コーデの `analysis_media_id` が null なら、それにする。
  - `public.replace_outfit_media_asset(p_user_id uuid, p_media_id uuid, p_asset_id text, p_upload_expires_at timestamptz) returns public.outfit_media`
    - 古い ID を `enqueue_media_deletion` に入れる。
    - 新しい ID に置き換え、`upload_attempt + 1`、`status = 'uploading'` にする。
  - `public.set_outfit_media_state(p_user_id uuid, p_media_id uuid, p_status text, p_width integer, p_height integer, p_duration_sec numeric) returns public.outfit_media`
    - 許可する変化：`uploading → processing | ready | failed`、`processing → ready | failed`、`ready → ready`、`failed → uploading`。
    - それ以外は message `invalid_media_transition` の例外にする。
  - `public.apply_stream_webhook(p_asset_id text, p_state text, p_width integer, p_height integer, p_duration_sec numeric) returns text`
    - `provider = 'cf_stream'` で、今の `provider_asset_id` が一致する行がなければ `'ignored'`。
    - 行があれば、その行の `user_id` で `outfit_lock_user` してから読み直す。
    - すでに `ready` で `p_state = 'ready'` なら `'duplicate'`。
    - それ以外は、`ready` → ready、`error` → failed、ほか → processing にして `'applied'`。
  - `public.claim_media_deletions(p_limit integer) returns setof public.media_deletion_queue`
    - 対象：`done_at is null`、`next_attempt_at <= now()`、`attempts < 10`、`lease_until is null or lease_until < now()`。
    - `for update skip locked` で取り出し、新しい `claim_token = gen_random_uuid()` と `lease_until = now() + interval '5 minutes'` を書いて返す。
  - `public.finish_media_deletion(p_id uuid, p_claim_token uuid, p_ok boolean, p_error text) returns boolean`
    - `claim_token` が一致しなければ何もせず false を返す。一致したら `claim_token` と `lease_until` を null に戻して true を返す。
    - 成功なら `done_at = now()`。
    - 失敗なら `attempts + 1` と `last_error` を記録し、`next_attempt_at` を延ばす。延ばす幅は、`attempts` が1なら1分、2なら10分、3なら1時間、4以上なら1日。

- [ ] **Step 1: 失敗するテストを書く**（`023_outfit_media_rpcs.test.sql`）

```sql
-- ok: register_outfit_media は B のコーデに A の user_id で登録しようとすると outfit_not_found
-- ok: 同じ media_id で2回呼ぶと行は1件。B の media_id を A の user_id で呼ぶと media_conflict
-- ok: 最初の写真が analysis_media_id になり、2枚目では変わらない
-- ok: 同じ provider_asset_id を別のメディアに登録すると一意制約で失敗する
-- ok: replace_outfit_media_asset で古い ID が削除待ちに入り、upload_attempt が 2 になる
-- ok: apply_stream_webhook：古い ID → ignored、今の ID の ready → applied、もう一度 ready → duplicate
-- ok: set_outfit_media_state：ready → uploading は invalid_media_transition
-- ok: claim_media_deletions は2つの接続から同時に呼んでも、同じ行を二重に返さない（run-outfits.sh で2接続）
-- ok: lease_until の前は取り出されず、過ぎたら別の claim_token で取り出し直せる
-- ok: 古い claim_token の finish_media_deletion は false で、行は変わらない
-- ok: finish_media_deletion の失敗4回目で next_attempt_at が約1日後、10回失敗した行は claim されない
-- ok: authenticated と anon から register_outfit_media・claim_media_deletions・rebuild_monthly_stats を呼ぶと、どれも insufficient_privilege（PUBLIC からの継承も残っていない）
```

- [ ] **Step 2: テストが失敗することを確かめる**

Run: `bash supabase/tests/run-outfits.sh`
Expected: FAIL（`function public.register_outfit_media(...) does not exist`）

- [ ] **Step 3: `023_outfit_media_rpcs.sql` を書く**

- [ ] **Step 4: テストが通ることを確かめる**

Run: `bash supabase/tests/run-outfits.sh`
Expected: すべて `ok:`

- [ ] **Step 5: コミットする**

```bash
git add supabase/migrations/023_outfit_media_rpcs.sql supabase/tests/023_outfit_media_rpcs.test.sql supabase/tests/run-outfits.sh
git commit -m "feat: add server-only outfit media RPCs and deletion queue"
```

---

### Task 8: アップロードの処理（media-service）

**Files:**
- Create: `lib/outfits/media-service.ts`
- Create: `lib/outfits/media-db.ts`
- Create: `lib/supabase/admin.ts`
- Modify: `package.json`（`test:outfits` に `'scripts/test-outfit-*.mts'` を足す）
- Test: `scripts/test-outfit-media-service.mts`

**Interfaces:**
- Consumes: Task 2 の `MediaStore`・`createFakeMediaStore`、Task 7 の RPC
- Produces:
  - `type OutfitMediaRow = { id: string; outfitId: string; userId: string; kind: "photo" | "video" | "frame"; provider: MediaProvider; providerAssetId: string; uploadAttempt: number; uploadExpiresAt: string | null; status: "uploading" | "processing" | "ready" | "failed"; width: number | null; height: number | null; durationSec: number | null }`
  - `interface OutfitMediaDb { registerMedia(i: { userId: string; mediaId: string; outfitId: string; kind: "photo" | "video"; provider: MediaProvider; assetId: string; uploadExpiresAt: Date; takenAt: Date | null; sortOrder: number }): Promise<OutfitMediaRow>; getMedia(userId: string, mediaId: string): Promise<OutfitMediaRow | null>; replaceAsset(i: { userId: string; mediaId: string; assetId: string; uploadExpiresAt: Date }): Promise<OutfitMediaRow>; setState(i: { userId: string; mediaId: string; status: OutfitMediaRow["status"]; width?: number; height?: number; durationSec?: number }): Promise<OutfitMediaRow> }`
  - `startMediaUpload(deps: { db: OutfitMediaDb; store: MediaStore; now: () => Date }, input: { userId: string; mediaId: string; outfitId: string; kind: "photo" | "video"; takenAt: Date | null; sortOrder: number }): Promise<{ mediaId: string; uploadUrl: string | null }>`
    - `mediaId` はブラウザがファイルごとに作った UUID。
    - `getMedia` で本人の行がすでにあれば、`retryMediaUpload` と同じ処理をする。
    - なければ `createUpload` → `registerMedia` の順に呼ぶ。`registerMedia` が失敗したら、`store.deleteAsset` を一度だけ試してから（失敗しても無視して）、元のエラーを投げ直す。
    - **同時に2回開始された場合**：`registerMedia` が返した行の `providerAssetId` が、自分が作った ID と違うことがある（もう一方が先に登録した）。そのときは、自分の ID を `deleteAsset` してから `MediaUploadConflictError` を投げる。画面は少し待ってから「もう一度送る」を出す。DB に登録されていない ID へ送らせないため。
  - `class MediaUploadConflictError extends Error`
  - `completeMediaUpload(deps, input: { userId: string; mediaId: string; width?: number; height?: number }): Promise<OutfitMediaRow>`：
    - 写真：実体が ready なら `ready`（ブラウザが知らせた大きさを入れる）。
    - 動画：実体が processing なら `processing`、ready なら `ready`。
    - awaiting_upload か missing なら、`MediaNotUploadedError` を投げる。
  - `retryMediaUpload(deps, input: { userId: string; mediaId: string }): Promise<{ mediaId: string; uploadUrl: string | null; row: OutfitMediaRow }>`：
    - 実体が ready か processing なら、完了として扱い、`uploadUrl: null` を返す。
    - そうでなければ、新しいアップロードを作って `replaceAsset` する。
  - `class MediaNotUploadedError extends Error`
  - `createAdminClient(): SupabaseClient`（`NEXT_PUBLIC_SUPABASE_URL` と `SUPABASE_SECRET_KEY`。セッションは保存しない。サーバーのファイルからだけ import する、とコメントに書く）
  - `createSupabaseOutfitMediaDb(admin: SupabaseClient): OutfitMediaDb`（Task 7 の RPC を呼び、snake_case を camelCase に直す）

- [ ] **Step 1: 失敗するテストを書く**（`OutfitMediaDb` はメモリ上のダミーを、テストファイルの中で作る。`store` は `createFakeMediaStore()`）

```ts
test("開始：渡されたメディア ID を、Cloudflare のメタデータと DB の両方に使う");
test("開始：同じメディア ID で2回呼ぶと、メディアは1つのままで、Cloudflare に届いていれば uploadUrl は null");
test("開始：DB への保存が失敗したら、作った Cloudflare の ID を deleteAsset してから元のエラーを投げる");
test("開始：registerMedia が別の asset ID の行を返したら（同時の開始）、自分の ID を消して MediaUploadConflictError");
test("開始：アップロード URL の期限は now の30分後");
test("完了：写真の実体が awaiting_upload なら MediaNotUploadedError で、状態は uploading のまま");
test("完了：写真の実体が ready なら ready になり、width・height が入る");
test("完了：動画の実体が processing なら processing");
test("送り直し：Cloudflare に届いていれば新しい試行を作らず、uploadUrl は null で ready になる");   // ← Review Focus 1
test("送り直し：期限切れ（missing）なら新しい asset を作り、replaceAsset で upload_attempt が増える");
test("他人のメディア ID：getMedia が null なら MediaNotFoundError（Cloudflare は呼ばない）");
```

- [ ] **Step 2: テストが失敗することを確かめる**

Run: `node --test scripts/test-outfit-media-service.mts`
Expected: FAIL（モジュールがない）

- [ ] **Step 3: `media-service.ts`、`media-db.ts`、`admin.ts` を実装する**（`MediaNotFoundError` も `media-service.ts` で export する）

- [ ] **Step 4: テストが通ることを確かめる**

Run: `node --test scripts/test-outfit-media-service.mts`
Expected: PASS（11 tests）

- [ ] **Step 5: コミットする**

```bash
git add lib/outfits/media-service.ts lib/outfits/media-db.ts lib/supabase/admin.ts package.json scripts/test-outfit-media-service.mts
git commit -m "feat: add outfit media upload service with retry that reuses delivered assets"
```

---

### Task 9: 削除待ちの処理と、webhook を DB につなぐ

**Files:**
- Create: `lib/media/deletion-queue.ts`
- Modify: `app/api/webhooks/cloudflare-stream/route.ts`（仮の `apply` を、`createAdminClient().rpc("apply_stream_webhook", ...)` に置き換える）
- Create: `app/api/cron/media-deletions/route.ts`
- Create: `vercel.json`（`{"crons":[{"path":"/api/cron/media-deletions","schedule":"0 18 * * *"}]}`。日本時間の毎日3:00）
- Test: `scripts/test-media-deletion-queue.mts`

**Interfaces:**
- Consumes: Task 2 の `MediaStore`、Task 3 の `handleStreamWebhook`、Task 7 の `apply_stream_webhook`・`claim_media_deletions`・`finish_media_deletion`、Task 8 の `createAdminClient`
- Produces:
  - `type QueueRow = { id: string; claimToken: string; provider: MediaProvider; providerAssetId: string; attempts: number }`
  - `processMediaDeletionQueue(deps: { claim: (limit: number) => Promise<QueueRow[]>; finish: (id: string, claimToken: string, ok: boolean, error: string | null) => Promise<boolean>; store: MediaStore }, limit?: number): Promise<{ deleted: number; failed: number }>`（`limit` の初期値は 20。`deleteAsset` が `not_found` でも成功）
  - cron のルート：`Authorization: Bearer ${CRON_SECRET}` を確かめてから `processMediaDeletionQueue` を呼ぶ。違えば 401。

- [ ] **Step 1: 失敗するテストを書く**（`scripts/test-media-deletion-queue.mts`）

```ts
test("Cloudflare の削除が成功：取り出したときの claimToken で finish(ok=true)、deleted=1");
test("Cloudflare が not_found：成功として扱う");
test("Cloudflare が例外：finish(ok=false, error のメッセージ)、failed=1。ほかの行は続けて処理する");
```

- [ ] **Step 2: テストが失敗することを確かめる**

Run: `node --test scripts/test-media-deletion-queue.mts`
Expected: FAIL（モジュールがない）

- [ ] **Step 3: `deletion-queue.ts`、cron のルート、`vercel.json` を実装し、webhook のルートの `apply` を RPC に置き換える**

- [ ] **Step 4: テストとビルドが通ることを確かめる**

Run: `npm run test:outfits && npm run lint && npm run build`
Expected: テストはすべて PASS、lint と build はエラーなし

- [ ] **Step 5: コミットする**

```bash
git add lib/media/deletion-queue.ts app/api vercel.json scripts/test-media-deletion-queue.mts
git commit -m "feat: add media deletion queue and wire Stream webhook to the database"
```

---

### Task 10: 書き込み権限の締め付けと初期集計（024）、既存の操作を RPC へ

**Files:**
- Create: `supabase/migrations/024_tighten_wear_writes.sql`
- Modify: `app/(main)/protected/items/[id]/actions.ts`
  - `recordWearToday` は `supabase.rpc("record_wear_today", { p_item_id })` にし、`hasWornToday` と直接の insert・update をやめる。
  - `deleteClothingItem` は、画像のパスを先に読み、`rpc("hard_delete_item")` を呼び、Storage の後片付けは今のまま残す。
- Test: `supabase/tests/024_tighten_wear_writes.test.sql`

**Interfaces:**
- Consumes: Task 5・6 の `rebuild_all_stats`、`record_wear_today`、`hard_delete_item`

`024_tighten_wear_writes.sql` の内容：
- `revoke insert, update, delete on public.wear_logs from authenticated;`
- `revoke insert, update on public.clothing_items from authenticated;` のあと、`do` ブロックで `information_schema.columns` から列の一覧を作り、2つの grant を動的に実行する。コメントに「今後 `clothing_items` に列を足すときは、ここと同じ grant を足す」と書く。
  - `grant insert (...)`：`wear_count`、`last_worn_at`、`archived_at` を除くすべての列。今の登録処理は `id` と `user_id` を指定しているので、この2つは含める。
  - `grant update (...)`：`id`、`user_id`、`created_at`、`wear_count`、`last_worn_at`、`archived_at` を除くすべての列。
- 削除の権限は今のまま残す（仕様書 6.3 章。コーデに入っている服は外部キーで消せない）。
- 初期集計：`for u in select distinct user_id from public.clothing_items loop perform public.rebuild_all_stats(u); end loop;`。直す前に、`wear_count` か `last_worn_at` が記録と違っていた服の件数を `raise notice` で出す。

- [ ] **Step 1: 失敗するテストを書く**（`024_tighten_wear_writes.test.sql`。`020_before_setup.sql` の既存データを使う）

```sql
-- ok: 初期集計で、A の 2026-09 と 2026-10 の item_monthly_stats ができ、件数が既存の着用記録と一致する
-- ok: 既存データで wear_count がずれていた服（before_setup でわざとずらした1着）が、記録の件数に直っている
-- ok: 2着の関係とコーデのサマリーは0件（推測で作らない）
-- ok: authenticated は wear_logs に insert・update・delete できない
-- ok: authenticated は clothing_items の title・status・is_public を update できる
-- ok: authenticated は wear_count・last_worn_at・archived_at を update できない
-- ok: authenticated は id・user_id・title・category を指定して服を insert できる（今の登録処理と同じ形）
-- ok: authenticated は wear_count = 999 や last_worn_at・archived_at を指定した insert ができない
-- ok: authenticated は登録失敗の取り消し（コーデに入っていない服の delete）ができる
-- ok: authenticated の record_wear_today は今までと同じく、wear_count が1増え、last_worn_at が今になる
-- ok: 019 の行動履歴に、record_wear_today の着用が1件記録される
```

- [ ] **Step 2: テストが失敗することを確かめる**

Run: `bash supabase/tests/run-outfits.sh`
Expected: FAIL（初期集計の行がない、または wear_logs への insert が通ってしまう）

- [ ] **Step 3: `024_tighten_wear_writes.sql` を書き、`actions.ts` の2つの関数を直す**

- [ ] **Step 4: テストとビルドが通ることを確かめる**

Run: `bash supabase/tests/run-outfits.sh && npm run lint && npm run build`
Expected: すべて `ok:`、lint と build はエラーなし

- [ ] **Step 5: 手で確かめる**（`npm run dev`、ローカルは本番 DB につながるので、確かめるのは本番へ適用したあと＝Task 12）。ここではビルドが通ることまででよい。

- [ ] **Step 6: コミットする**

```bash
git add supabase/migrations/024_tighten_wear_writes.sql supabase/tests/024_tighten_wear_writes.test.sql "app/(main)/protected/items/[id]/actions.ts"
git commit -m "feat: route wear and delete through RPCs and backfill monthly stats"
```

---

### Task 11: つながりの計算（純粋な関数）

**Files:**
- Create: `lib/outfits/relations.ts`
- Create: `lib/outfits/dates.ts`
- Test: `scripts/test-outfit-relations.mts`

**Interfaces:**
- Produces:
  - `type PairMonthRow = { item_a: string; item_b: string; month: string; outfit_count: number; together_days: number; last_worn_on: string | null }`
  - `type Partner = { itemId: string; outfitCount: number; lastWornOn: string | null }`
  - `aggregatePartners(rows: readonly PairMonthRow[], itemId: string): Partner[]`
    - 相手ごとに `outfit_count` を足し、`last_worn_on` は最大を取る。
    - 並び順：`outfitCount` の多い順 → `lastWornOn` の新しい順 → `itemId` の昇順。
  - `type RadialLine = { itemId: string; x: number; y: number; nodeRadius: number; strokeWidth: number }`
  - `layoutRadialLines(partners: readonly Partner[], opts: { max: number; innerRadius: number; outerRadius: number }): RadialLine[]`
    - 先頭から `max` 件を、真上（-90°）から時計回りに等間隔で並べる。
    - 中心からの距離：回数が最大の相手は `innerRadius`、最小の相手は `outerRadius`。全員同じ回数なら `innerRadius`。
    - `nodeRadius`：12〜24。
    - `strokeWidth`：1〜6。回数の比に合わせて線で結ぶ。
  - `jstTodayIsoDate(now?: Date): string`（`YYYY-MM-DD`、日本時間）

- [ ] **Step 1: 失敗するテストを書く**

```ts
test("aggregatePartners：item_a と item_b のどちらにいても相手として数え、月をまたいで足す");
// rows: (T,D,2026-09,2,..,'2026-09-20') (D,T 逆順にはならない前提で a<b) (T,D,2026-10,3,..,'2026-10-22') (G,T,2026-10,1,..)
// → [{D,5,'2026-10-22'},{G,1,...}]
test("aggregatePartners：同じ回数なら最後に着た日が新しい方が先");
test("layoutRadialLines：1件目は真上（x≈0, y=-innerRadius）、max を超えた分は出さない");
test("layoutRadialLines：最少回数の相手は outerRadius、線の太さは 1〜6");
test("jstTodayIsoDate：UTC 2026-10-24T15:30Z（日本時間 10/25 0:30）は '2026-10-25'");  // ← Review Focus 5
```

- [ ] **Step 2: テストが失敗することを確かめる**

Run: `node --test scripts/test-outfit-relations.mts`
Expected: FAIL（モジュールがない）

- [ ] **Step 3: `relations.ts` と `dates.ts` を実装する**

- [ ] **Step 4: テストが通ることを確かめる**

Run: `node --test scripts/test-outfit-relations.mts`
Expected: PASS（5 tests）

- [ ] **Step 5: コミットする**

```bash
git add lib/outfits/relations.ts lib/outfits/dates.ts scripts/test-outfit-relations.mts
git commit -m "feat: add partner aggregation and radial line layout"
```

---

### Task 12: 細い1本の流れの画面と、本番での通しの確認（10/31 の到達点）

**Files:**
- Modify: `lib/image-processing.ts`（`OUTFIT_UPLOAD_IMAGE_OPTIONS = { maxLongEdge: 2560, quality: 0.9 }` と `processImageForOutfitUpload(file, rotation)` を足す。`processImageForUpload` と同じ形）
- Create: `app/(main)/protected/looks/actions.ts`
- Create: `app/(main)/protected/looks/new/page.tsx`
- Create: `app/(main)/protected/looks/[id]/page.tsx`
- Create: `components/outfit-quick-record-form.tsx`
- Create: `components/outfit-item-picker.tsx`
- Create: `components/relation-lines.tsx`
- Modify: `app/(main)/protected/items/[id]/page.tsx`（「記録」の上に「よく合わせる服」の区画を入れる。区画の中身は `RelationLines` と、「この服で着画を記録」→ `/protected/looks/new?item=<id>`）

**Interfaces:**
- Consumes: Task 6 の RPC、Task 8 の `startMediaUpload`・`completeMediaUpload`・`retryMediaUpload`・`createSupabaseOutfitMediaDb`・`createAdminClient`、Task 2 の `createCloudflareMediaStore`、Task 11 の `aggregatePartners`・`layoutRadialLines`・`jstTodayIsoDate`
- Produces（Server Actions。どれも最初にログインを確かめ、ユーザー ID はサーバーで決める）：
  - `startOutfitPhotoUpload(input: { clientRequestId: string; mediaId: string; wornOn: string }): Promise<{ outfitId: string; mediaId: string; uploadUrl: string | null } | { error: string }>`
    - `create_outfit_draft`（source は `upload`）のあと `startMediaUpload` を呼ぶ。`takenAt` は null、`sortOrder` は 0。
    - `uploadUrl` が null なら、もう届いているので送らずに完了へ進む。
  - `completeOutfitMedia(input: { mediaId: string; width: number; height: number }): Promise<{ ok: true } | { error: string }>`
  - `retryOutfitMedia(input: { mediaId: string }): Promise<{ uploadUrl: string | null } | { error: string }>`
    - 新しい試行に置き換えたときは、`after(() => processMediaDeletionQueue(...))` で、削除待ちに入った古い ID をすぐ消しにいく（仕様書 6.6 章）。
  - `confirmOutfitAction(input: { outfitId: string; expectedRevision: number; wornOn: string; itemIds: string[]; note: string | null }): Promise<{ status: "confirmed" | "unchanged" | "stale"; revision: number } | { error: string }>`
    - `item_not_found` なら `{ error: "選んだ服が見つかりませんでした。一覧を開き直してください" }`
    - `outfit_not_found` なら `{ error: "このコーデが見つかりませんでした" }`
    - 成功したら `/protected/looks/[id]` と、選んだ服の詳細ページを `revalidatePath` する。
  - `RelationLines`（Server Component）：`{ itemId: string }`
    - `item_pair_monthly_stats` を `.or(item_a.eq.X,item_b.eq.X)` で読み、`aggregatePartners` と `layoutRadialLines({ max: 8, innerRadius: 70, outerRadius: 130 })` で並べる。
    - 相手の服の写真を、今の `getPrivateSignedImageUrls` で丸く出し、SVG の線で真ん中とつなぐ。
    - 相手がいなければ「まだ一緒に着た記録がありません。着画を撮ると、ここに線が伸びます」と出す。

画面の流れ（`/protected/looks/new`）：
1. 写真を1枚選ぶ → `processImageForOutfitUpload` → `startOutfitPhotoUpload` → `fetch(uploadUrl, { method: "POST", body: FormData(file) })` → `completeOutfitMedia`。
2. 失敗したら「もう一度送る」→ `retryOutfitMedia`（`uploadUrl` が null なら完了として進む）。
3. 日付の初期値は `jstTodayIsoDate()`。`?item=<id>` があれば、その服を選んだ状態にする。
4. `OutfitItemPicker`：しまっていない服をカテゴリーのタブで出し、複数選べる。
5. 「確定」→ `confirmOutfitAction`（`expectedRevision: 0`）→ `/protected/looks/[id]` へ。
6. `clientRequestId` は画面を開いたときに、`mediaId` は写真を選んだときに、それぞれ `crypto.randomUUID()` で作る。送り直しでも同じものを使う。

`/protected/looks/[id]`：写真（`display` の署名付き URL、`MediaStore.signedImageUrl`）、日付、服の一覧（それぞれ詳細ページへのリンク）。

- [ ] **Step 1: 画面を実装する**（`node_modules/next/dist/docs/` の Server Actions と動的ルートの説明を先に読む）

- [ ] **Step 2: lint とビルドを確かめる**

Run: `npm run lint && npm run build`
Expected: エラーなし

- [ ] **Step 3: 本番に適用する（ユーザーの作業）**
  1. Supabase の SQL Editor で、020 → 021 → 022 → 023 → 024 の順に実行する。024 の `notice` に出た件数を TODO に記録する。
  2. Vercel の環境変数に、Task 1 の環境変数を入れる。
  3. ブランチをプッシュし、プレビューをデプロイする。

- [ ] **Step 4: 本番で通しで確かめる**（手動の確認リスト。結果を TODO に記録する）
  - [ ] 服の詳細 →「この服で着画を記録」→ 写真を選ぶ → 送れる。
  - [ ] 別の服を2着足して「確定」→ コーデの画面に写真と3着が出る。
  - [ ] 服の詳細の「よく合わせる服」に、2着への線が出る。
  - [ ] 「確定」を連打しても、着用回数は1回しか増えない。
  - [ ] 送る途中で通信を切り（DevTools の Offline）、戻してから「もう一度送る」で完了する。
  - [ ] 「今日着た」と服の削除が、今までどおり動く。
  - [ ] webhook が DB につながったあとも、smoke の動画を送ると 200 と `ignored` が返る（メディアの行がないため）。通知先の登録は Task 3 で済んでいる。

- [ ] **Step 5: コミットする**

```bash
git add lib/image-processing.ts "app/(main)/protected/looks" components/outfit-quick-record-form.tsx components/outfit-item-picker.tsx components/relation-lines.tsx "app/(main)/protected/items/[id]/page.tsx" docs/project/TODO.md
git commit -m "feat: add thin outfit recording flow with relation lines"
```

---

## 仕様との対応（このプランで扱わないもの）

| 仕様の項目 | 担当 |
|---|---|
| 解析の実行（`outfit_analysis_runs`）、認識結果（`outfit_detections`）、AI の3段階、本人の選択、正解率 | Plan 2 |
| 撮影画面、EXIF、動画だけの取り込み（`frame`）、動画のアップロードの画面、Stream の状態を画面を開いたときに確かめる処理 | Plan 2 |
| 確認画面、新しく登録（切り出し） | Plan 2 |
| 「＋記録」ボタン、Looks の最低限、確定直後の演出、マップ（タップ・来た道・再生・ドラッグ）、アプリを開いたときの削除待ちの処理 | Plan 3 |
| アーカイブの RPC と画面、自分で付ける関係、季節の比較、マップの残りの仕掛け、写真なしで記録、「今日着た」からの提案、小物のカテゴリー | Plan 4 |
