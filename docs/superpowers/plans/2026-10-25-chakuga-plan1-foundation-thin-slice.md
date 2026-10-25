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
- どの関数も、作ったのと同じトランザクションで `revoke all on function ... from public, anon, authenticated, service_role` してから、必要なロールにだけ `grant` する。PostgreSQL は新しい関数を誰でも（`PUBLIC`）実行できるうえ、Supabase は `public` スキーマの既定の権限で `anon`・`authenticated`・`service_role` に許可することがあるため。新しいテーブルも同じく、`revoke all ... from anon, authenticated, service_role` してから必要な権限だけを付ける。
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
- プランの `test("名前")` や `-- ok: ...` の行は、**テストするケースの一覧**。実装する人が、コメントに書いた値で assert を書く。名前だけのテストや、assert のないテストは残さない。
- DB のテストは Docker の Postgres 15 を使う（`supabase/tests/run-019.sh` と同じ仕組み）。本番の DB には絶対につながない。
  - テストのファイルは、それぞれ `begin;` 〜 `rollback;` で包み、ほかのファイルにデータを残さない。ユーザーの切り替えは `set local role ...` と `set_config('request.jwt.claim.sub', ..., true)`（どちらもトランザクションの中だけ有効）。確かめるときは `reset role` で postgres に戻る。
  - 操作の前に、`current_user` と `auth.uid()` が意図したものかを assert する。
  - 失敗するはずの文は、例外を受け止める補助関数（`test.expect_error`・`test.expect_denied`）の中で動かす。そのまま失敗させると、トランザクション全体が止まるため。
  - 1つのトランザクションの中では `now()` が変わらない。時間が過ぎたことを確かめるテストは、postgres で時刻の列（`lease_until` など）を直接過去にする。
  - 同時実行のテストだけは、専用のユーザー C の commit 済みデータで、すべてのテストのファイルのあとに動かす。
- 画面の言葉は今のアプリに合わせ、責めない言い方にする。コメントは日本語で、まわりのコードと同じくらいの量にする。
- 各タスクが終わったら、差分を Codex（Herdr のペイン `w4:p2`、Astra モデル）にレビューしてもらい、指摘に対応してから次へ進む。

## Review Focus

1. **応答だけが失われたアップロード**：Cloudflare には届いたのに、ブラウザが完了を知らせる前に通信が切れる。そのあと「もう一度送る」を押したら、新しい試行を作らずに、届いている実体を使うこと（Task 8 にテストを追加）。
2. **「確定」の二度押しと、2つのタブ**：同じコーデを同じ内容で2回確定しても、版番号は1回だけ増え、着用記録も1件だけになること（Task 6a にテストを追加）。
3. **選んだ服が別のタブで削除済み**：確定のときに存在しない服や、他人の服の ID が混ざっていたら、何も書き込まずにエラーを返すこと。画面は「選んだ服が見つかりませんでした」と出すこと（Task 6a にテストを追加）。
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
| `supabase/tests/outfits_test_helpers.sql` | テストの補助関数（`test.assert`・`test.expect_denied`・`test.expect_error`） |
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
  - 設定は、使う場面ごとに3つに分ける。初期設定のスクリプトは、まだ鍵や配信の ID がない状態で動くため。
    - `type CloudflareApiConfig = { accountId: string; apiToken: string }`
    - `type CloudflareConfig = CloudflareApiConfig & { imagesAccountHash: string; imagesSigningKey: string; streamCustomerCode: string; streamSigningKeyId: string; streamSigningJwk: string }`（配信の署名まで必要な `MediaStore` 用）
  - `readCloudflareApiConfig(env?: Record<string, string | undefined>): CloudflareApiConfig`
  - `readCloudflareConfig(env?: Record<string, string | undefined>): CloudflareConfig`
  - `readStreamWebhookSecret(env?: Record<string, string | undefined>): string`（webhook のルートは、これだけを読む）
  - どれも、足りない環境変数の名前をすべて挙げた `Error` を投げる。値は message に入れない。
  - `signImagesDeliveryUrl(input: { accountHash: string; imageId: string; variant: "thumb" | "display" | "analysis"; signingKey: string; expiresAt: Date }): string`
  - `createStreamToken(input: { videoUid: string; keyId: string; jwkBase64: string; expiresAt: Date; now: Date }): string`
  - `buildStreamUrls(input: { customerCode: string; token: string }): { manifestUrl: string; thumbnailUrl: string; previewGifUrl: string }`
  - `verifyStreamWebhookSignature(input: { header: string | null; rawBody: string; secret: string; now: Date; toleranceSec?: number }): { ok: true } | { ok: false; reason: "missing" | "malformed" | "expired" | "mismatch" }`

環境変数：`SUPABASE_SECRET_KEY`、`CLOUDFLARE_ACCOUNT_ID`、`CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_IMAGES_ACCOUNT_HASH`、`CLOUDFLARE_IMAGES_SIGNING_KEY`、`CLOUDFLARE_STREAM_CUSTOMER_CODE`、`CLOUDFLARE_STREAM_SIGNING_KEY_ID`、`CLOUDFLARE_STREAM_SIGNING_JWK`、`CLOUDFLARE_STREAM_WEBHOOK_SECRET`、`CRON_SECRET`。`VERCEL_AUTOMATION_BYPASS_SECRET` は `.env.local` だけに置く（Task 3 の webhook の確認で使う。Vercel には入れない）。

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
test("webhook：301秒より未来も expired");                    // now = 1699999699 → expired（now = 1699999700 は ok）。ずれは絶対値で比べる
test("webhook：ヘッダーがないと missing、形が違うと malformed"); // null → missing、"sig1=abc" → malformed
test("設定：API 用は、アカウント ID とトークンだけの環境で読める");  // readCloudflareApiConfig({ CLOUDFLARE_ACCOUNT_ID: "a", CLOUDFLARE_API_TOKEN: "t" }) が通る
test("設定：署名用は、足りない環境変数の名前をすべて挙げて例外にする"); // readCloudflareConfig({ CLOUDFLARE_ACCOUNT_ID: "a", CLOUDFLARE_API_TOKEN: "t" }) の message に
                                                               // CLOUDFLARE_IMAGES_ACCOUNT_HASH と CLOUDFLARE_STREAM_SIGNING_JWK を含み、"t" は含まない
test("設定：webhook の秘密だけを読める");                       // readStreamWebhookSecret({}) の message は CLOUDFLARE_STREAM_WEBHOOK_SECRET
```

- [ ] **Step 2: テストが失敗することを確かめる**

Run: `node --test scripts/test-cloudflare-signing.mts`
Expected: FAIL（`lib/media/cloudflare-signing.ts` が見つからない）

- [ ] **Step 3: `lib/media/cloudflare-config.ts` と `lib/media/cloudflare-signing.ts` を実装する**

`node:crypto` の `createHmac`、`createPrivateKey({ key: jwk, format: "jwk" })`、`createSign("RSA-SHA256")`、`timingSafeEqual` を使う。JWT の各部分は base64url。webhook の比較は、長さが違えば `timingSafeEqual` を呼ばずに mismatch にする。

- [ ] **Step 4: テストが通ることを確かめる**

Run: `node --test scripts/test-cloudflare-signing.mts`
Expected: PASS（12 tests）

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
- Consumes: Task 1 の `CloudflareApiConfig`、`CloudflareConfig`、`signImagesDeliveryUrl`、`createStreamToken`、`buildStreamUrls`
- Produces:
  - `type MediaProvider = "cf_images" | "cf_stream"`
  - `type AssetState = { state: "missing" | "awaiting_upload" | "processing" | "ready" | "failed"; width?: number; height?: number; durationSec?: number }`
  - `interface MediaStore { createUpload(input: { kind: "photo" | "video"; userId: string; mediaId: string; expiresAt: Date }): Promise<{ provider: MediaProvider; assetId: string; uploadUrl: string }>; getAssetState(provider: MediaProvider, assetId: string): Promise<AssetState>; deleteAsset(provider: MediaProvider, assetId: string): Promise<"deleted" | "not_found">; signedImageUrl(assetId: string, variant: "thumb" | "display" | "analysis", now: Date): string; signedStreamUrls(assetId: string, now: Date): { manifestUrl: string; thumbnailUrl: string; previewGifUrl: string } }`
  - `mapStreamState(input: { state: string | null; readyToStream: boolean }): AssetState["state"]`（`media-store.ts`。ポーリング・完了の知らせ・webhook のすべてで、この1つの対応を使う）
  - `createCloudflareApi(config: CloudflareApiConfig, fetchImpl?: typeof fetch)`（下の6つの関数を持つオブジェクト。API の設定だけで動く）
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
| `getStreamVideo(uid)` | `GET /stream/{uid}` | ― | `{ state, readyToStream, width, height, duration, preview }`。404 なら `null`。公式の応答は入れ子なので平らに直す：`state = result.status.state`、`readyToStream = result.readyToStream`、`width = result.input.width`、`height = result.input.height`、`duration = result.duration`、`preview = result.preview`。寸法と長さは、まだないとき（`-1` か値なし）は `null` |
| `deleteStreamVideo(uid)` | `DELETE /stream/{uid}` | ― | 404 なら `"not_found"` |

状態の対応：
- Images：`null` → missing、`draft: true` → awaiting_upload、それ以外 → ready。
- Stream（`mapStreamState`）：
  - `null` → missing。`pendingupload` → awaiting_upload。`error` → failed。
  - `ready` で `readyToStream: true` → ready。`ready` でも `readyToStream: false` なら processing。
  - `downloading`・`queued`・`inprogress`、知らない値 → processing。

- [ ] **Step 1: 失敗するテストを書く**（`fetchImpl` に、呼ばれた URL・メソッド・本文を記録して決まった JSON を返すダミーを渡す）

```ts
test("写真のアップロード URL：direct_upload に requireSignedURLs と metadata と expiry を送る", async () => {
  // 返り値 { provider: "cf_images", assetId: "img-1", uploadUrl: "https://upload.example/img-1" }
  // 送った FormData の requireSignedURLs === "true"、JSON.parse(metadata) が { userId: "u1", mediaId: "m1" }、expiry === "2026-10-25T00:30:00.000Z"
});
test("動画のアップロード URL：maxDurationSeconds 60、requireSignedURLs true、meta に userId と mediaId");
test("getAssetState：Images の draft は awaiting_upload、draft なしは ready、404 は missing");
test("getAssetState：Stream の pendingupload/inprogress/ready/error/404 を対応する状態にし、ready では width・height・durationSec を返す");
// ダミーの応答は公式と同じ入れ子の形にする：{ success: true, result: { uid, readyToStream, status: { state }, input: { width, height }, duration, preview } }
test("mapStreamState：state が ready でも readyToStream が false なら processing");
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
Expected: PASS（9 tests）

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
- Consumes: Task 1・2 の `readCloudflareApiConfig`、`readCloudflareConfig`、`readStreamWebhookSecret`、`verifyStreamWebhookSignature`、`createCloudflareApi`、`createCloudflareMediaStore`、`mapStreamState`、`analyzeClothingImage`（`lib/clothing-image-analysis.ts`）
- Produces:
  - `handleStreamWebhook(input: { header: string | null; rawBody: string; secret: string; now: Date; apply: (p: { assetId: string; status: "processing" | "ready" | "failed"; width: number | null; height: number | null; durationSec: number | null }) => Promise<"applied" | "ignored" | "duplicate"> }): Promise<{ status: 200 | 400 | 401; result?: string }>`
    - 署名が通らなければ 401。
    - 本文の JSON が読めない、または `uid` がなければ 400。
    - それ以外は `apply` の結果と 200。
    - 本文から読むもの：`uid`、`status.state`、`readyToStream`、`input.width`、`input.height`、`duration`。
    - 状態は `mapStreamState` で直してから `apply` に渡す。`awaiting_upload`・`missing` になる通知は `apply` を呼ばずに 200 と `ignored`。
  - ルート：`request.text()` で生の本文を読み、`readStreamWebhookSecret()` の秘密で `handleStreamWebhook` を呼ぶ（ほかの Cloudflare の設定は読まない）。このタスクでは、`apply` は「uid と status を `console.info` に出して `"ignored"` を返す」仮のものにする（DB は Task 9 でつなぐ）。Next.js のルートの書き方は、先に `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md` を読んで合わせる。

**ユーザーにお願いすること（このタスクの前に）：**
- （済、2026-10-25）Cloudflare の Images & Stream Starter Bundle を契約する。
- （済、2026-10-25）API トークンを作り、`CLOUDFLARE_ACCOUNT_ID`、`CLOUDFLARE_API_TOKEN` を `.env.local` に入れる。トークンの期限は 2026-11-24。
- 5秒ほどの短い MP4 を1本と、服が写った写真（JPEG）を1枚用意する。

- [ ] **Step 1: webhook の失敗するテストを書く**（`scripts/test-media-stream-webhook.mts`）

```ts
test("正しい署名：apply を呼び、200 と結果を返す");
test("署名が違う：401 で、apply を呼ばない");
test("知らない uid（apply が ignored）：200 で ignored");                       // ← Review Focus 4
test("同じ通知の2回目（apply が duplicate）：200");
test("本文が JSON でない：400");
test("state が ready でも readyToStream が false：apply には processing を渡す");
// 本文は公式と同じ形：{ uid, readyToStream, status: { state, pctComplete }, input: { width, height }, duration, meta }
```

- [ ] **Step 2: テストが失敗することを確かめる**

Run: `node --test scripts/test-media-stream-webhook.mts`
Expected: FAIL（モジュールがない）

- [ ] **Step 3: `stream-webhook.ts`、ルート（仮の `apply`）、`proxy.ts` を実装し、テストを通す**

Run: `node --test scripts/test-media-stream-webhook.mts && npm run lint && npm run build`
Expected: PASS（6 tests）、lint と build はエラーなし

- [ ] **Step 4: `scripts/setup-cloudflare.mts` を書く**（何度実行しても同じ結果になる。`readCloudflareApiConfig` だけで起動する）
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
     - Stream の通知先は**アカウントに1つだけ**。登録し直すと前の通知先は使われなくなる。
     - 環境変数 `VERCEL_AUTOMATION_BYPASS_SECRET` があり、URL が本番のドメインでなければ、URL に `?x-vercel-protection-bypass=<秘密>` を付けて登録する（プレビューの保護を通るため）。付けた URL は画面に出さず、「保護を通る設定を付けました」とだけ出す。
     - 秘密は、登録の応答か `GET /stream/webhook` から取る。
  - Vercel に入れる値は、ユーザーが `.env.local` を開いてコピーする（Claude は `.env.local` の中身を読まない）。

- [ ] **Step 5: `scripts/smoke-cloudflare.mts` を書く**（引数：服の写真の JPEG のパスと、MP4 のパス。どの段階が失敗したかを表示して、終了コード1で止まる）
  - アップロードと配信の ID の取り出し（1〜2）は、`readCloudflareApiConfig` と `createCloudflareApi` だけで行う。2つの配信の ID がそろってから（3）、署名付き URL を確かめる。
  - 作った写真と動画の ID は配列に持ち、**`try` 〜 `finally` で必ず後片付けする**（途中の段階が失敗しても消す）。削除にも失敗したら、ID と種類だけを表示して終了コード1にする（秘密は出さない）。
  1. 写真：`createImageUpload` → 渡された JPEG を `uploadUrl` に POST → `getImage` が draft でない。`CLOUDFLARE_IMAGES_ACCOUNT_HASH` がまだなければ、`getImage` の応答の `variants` の URL（`https://imagedelivery.net/<hash>/<id>/<variant>`）から取り出して使い、`.env.local` に書き込む（秘密ではないが、書き方をそろえる）。そのため Task 2 の `getImage` は `{ draft: boolean; variants: string[] }` を返す。
  2. 動画：`createStreamUpload` → MP4 を POST → `mapStreamState` が ready になるまで5秒ごとに確かめる（最大3分）。`CLOUDFLARE_STREAM_CUSTOMER_CODE` がまだなければ、動画の応答の `preview` の URL（`https://customer-<CODE>.cloudflarestream.com/...`）から取り出して使い、`.env.local` に書き込む（そのため `getStreamVideo` は `preview` も返す）。
  3. 取り出した2つの値を足して `readCloudflareConfig({ ...process.env, CLOUDFLARE_IMAGES_ACCOUNT_HASH: ..., CLOUDFLARE_STREAM_CUSTOMER_CODE: ... })` と `createCloudflareMediaStore` を作る（署名の鍵は、先に setup の `--stream-key` で入れておく）。
  4. 写真の署名：署名なしの `https://imagedelivery.net/{hash}/{id}/thumb` が 200 でない。3つのバリアントの署名付き URL が、どれも 200。
  5. AI の入力：`analysis` の署名付き URL の中身を `analyzeClothingImage()` に渡し、結果の `category` を表示する。
  6. 動画の署名：署名なしの manifest とサムネイルが 200 でない。署名付きは 200。
  7. 後片付け（`finally`）：写真と動画を削除 → 両方とも `getImage`・`getStreamVideo` が `null`。

- [ ] **Step 6: 動かす**

Run: `node --env-file=.env.local scripts/setup-cloudflare.mts --check`（読むだけ。上限と今の量を確かめる）
Run: `node --env-file=.env.local scripts/setup-cloudflare.mts --stream-key`（鍵は `.env.local` に書き込まれ、画面には出ない）
Run: `node --env-file=.env.local scripts/smoke-cloudflare.mts ~/Desktop/test-outfit.jpg ~/Desktop/test.mp4`
Expected: すべての段階が `ok:` で、終了コード0

- [ ] **Step 7: webhook を本番相当で確かめる**（**Task 12b の Step 1 で 020〜023 を本番に適用したあとに行う**。Task 9 で、このルートは 023 の `apply_stream_webhook` を呼ぶようになったため、DB に 023 がないと 500 になる。10/26 の確認は Step 6 の setup と smoke まで）
  1. ブランチをプッシュし、Vercel のプレビューに `CLOUDFLARE_STREAM_WEBHOOK_SECRET` 以外の環境変数を入れてデプロイする。通知先には、デプロイごとに変わる URL ではなく、ブランチの固定の URL（`<プロジェクト>-git-<ブランチ>-<アカウント>.vercel.app`）を使う。
  2. プレビューが保護されているかを確かめる：`curl -s -o /dev/null -w "%{http_code}" -X POST https://<ブランチの URL>/api/webhooks/cloudflare-stream`。
     - 401 か、Vercel のログイン画面への転送なら、保護されている。ユーザーが Vercel の Settings → Deployment Protection → Protection Bypass for Automation で秘密を作り、`.env.local` の `VERCEL_AUTOMATION_BYPASS_SECRET` に入れる。
     - アプリの 401（署名がないため）が返れば、保護はない。どちらの 401 かは、本文に Vercel のログイン画面が含まれるかで見分ける。
  3. `node --env-file=.env.local scripts/setup-cloudflare.mts --webhook https://<ブランチの URL>/api/webhooks/cloudflare-stream --preview` を実行する（秘密は `.env.local` に書き込まれる。`--preview` を付けたときだけ、保護を通る設定が URL に付く）。ユーザーがその値を Vercel の Preview に入れて、もう一度デプロイする。
  4. smoke をもう一度動かし、Vercel のログ（Requests）で、webhook への POST が 200 であることを確かめる。応答の本文（`{"result":"ignored"}`。smoke の動画には outfit_media の行がないため）はログに出ないので、状態コードで判断する。401 なら署名か秘密、500 なら 023 の適用か `SUPABASE_SECRET_KEY` を確かめる。
  5. 通知先は、本番に切り替えるとき（Task 12b）に本番のドメインへ登録し直す。

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
  - `wear_logs`：`source text not null default 'wear_today' check (source in ('wear_today','outfit'))`、制約 `unique (id, clothing_item_id)`（下の `outfit_items` の複合外部キーのため）
  - `outfits`：`id, user_id, worn_on date, source, status default 'pending', revision int default 0, client_request_id uuid, analysis_media_id uuid, selected_person_index int, note text, confirmed_at, created_at, updated_at`、`unique (user_id, client_request_id)`、`unique (id, user_id)`
  - `outfit_media`：`id, user_id, outfit_id, kind, provider, provider_asset_id text, upload_attempt int default 1, upload_expires_at, status default 'uploading', width, height, duration_sec numeric, taken_at, sort_order int default 0, created_at, updated_at`。外部キー `(outfit_id, user_id) → outfits(id, user_id) on delete cascade`。`unique (provider, provider_asset_id)`、`unique (id, outfit_id)`
  - `outfits.analysis_media_id`：外部キー `(analysis_media_id, id) → outfit_media(id, outfit_id) on delete set null (analysis_media_id)`
  - `outfit_items`：`outfit_id, item_id, user_id, wear_log_id uuid unique, source default 'manual', detection_id uuid, created_at, updated_at`。主キー `(outfit_id, item_id)`。外部キーは次の3つ。
    - `(outfit_id, user_id) → outfits on delete cascade`
    - `(item_id, user_id) → clothing_items(id, user_id) on delete restrict`
    - `(wear_log_id, item_id) → wear_logs(id, clothing_item_id) on delete set null (wear_log_id)`。その服の着用記録しかつなげない。服と持ち主の外部キーと合わせて、本人のその服の記録に限られる。`wear_log_id` が null の行は確かめない（`match simple`）
  - `item_monthly_stats(user_id, item_id, month, wear_log_count, worn_days, outfit_count, last_worn_on, updated_at)`。主キー `(user_id, item_id, month)`
  - `item_pair_monthly_stats(user_id, item_a, item_b, month, outfit_count, together_days, last_worn_on, updated_at)`。主キー `(user_id, item_a, item_b, month)`、`check (item_a < item_b)`
  - `outfit_combo_monthly_stats(user_id, combo_key text, item_ids uuid[], month, outfit_count, last_worn_on, updated_at)`。主キー `(user_id, combo_key, month)`
  - `media_deletion_queue(id, user_id uuid（外部キーなし）, provider, provider_asset_id, attempts int default 0, next_attempt_at default now(), claim_token uuid, lease_until timestamptz, last_error, done_at, created_at, updated_at)`。`unique (provider, provider_asset_id)`

決めごと：
- サマリーは事実から作り直せる派生データで、同期の対象ではないので、主キーは複合キーにする。`month` には `check (extract(day from month) = 1)` を付ける。服への外部キーは `(item_id, user_id) → clothing_items(id, user_id) on delete cascade`。
- RLS は、全テーブルで `user_id = (select auth.uid())` の select ポリシーだけを作る。
- `authenticated` には select だけ許可する（キューには何も許可しない）。`service_role` には select・insert・update・delete を許可する。
- インデックス：`outfits (user_id, worn_on desc)`、`outfit_items (user_id, item_id)`、`outfit_media (outfit_id, sort_order)`、`media_deletion_queue (next_attempt_at) where done_at is null`。

- [ ] **Step 1: `run-outfits.sh` と補助関数を書く**
  - `run-019.sh` をもとにする：stub → 001〜019 → `020_before_setup.sql` → `supabase/migrations/02[0-9]_*.sql` のうち存在するものを番号順に適用 → `outfits_test_helpers.sql` → `supabase/tests/02[0-9]_*.test.sql` を順に `run_test` → 同時実行のテスト（Task 6b 以降で足す）。
  - 020 の前に、Supabase の既定の権限をいちばん広い形でまねる：`alter default privileges in schema public grant all on tables to anon, authenticated, service_role;` と、`functions` について同じもの。取り上げ忘れがあれば、権限のテストで見つかるようにするため（stub は変えない。019 までのテストに影響させない）。
  - 020 については、019 と同じ「commit の直前でわざと失敗させても何も残らない」確認を入れる。
  - `020_before_setup.sql` に入れる既存データ：ユーザー A（服3着、着用記録5件。2026-09 と 2026-10 にまたがり、日本時間の深夜 0:30 の記録を1件含める）とユーザー B（服1着、着用記録1件）。同時実行のテスト用に、ユーザー C（服2着、記録なし）も入れる。C のデータは、ほかのテストの assert で数えない。
  - `supabase/tests/outfits_test_helpers.sql`（commit して残す）：`test.assert`・`test.expect_denied`（019 と同じ）と、`test.expect_error(stmt text, expected_message text, msg text)`。`expect_error` は、`stmt` を動かして例外を受け止め、`SQLERRM` に `expected_message` が含まれれば `ok:`、例外が出なければ `FAIL`。

- [ ] **Step 2: 失敗するテストを書く**（`020_outfit_schema.test.sql`。全体を `begin;` 〜 `rollback;` で包む。書き方は Global Constraints の DB のテストのとおり）

```sql
-- ok: 既存の着用記録の source はすべて wear_today
-- ok: A は自分の outfits を読めるが、B の outfits は0件しか見えない（outfit_media・outfit_items・サマリー3つも同じ）
-- ok: authenticated は outfits / outfit_items / outfit_media / サマリーに insert できない（insufficient_privilege）
-- ok: authenticated は media_deletion_queue を select できない
-- ok: anon は新しいテーブルのどれも select できない（既定の権限をまねた状態でも）
-- ok: B の服を A のコーデの outfit_items に入れる insert（postgres で実行）は外部キーで失敗する
-- ok: A の服 T の行に、A の別の服 D の着用記録を wear_log_id として入れる（postgres で実行）と外部キーで失敗する
-- ok: 着用記録を消すと、outfit_items の wear_log_id だけが null になり、行は残る
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
git add supabase/migrations/020_create_outfit_schema.sql supabase/tests/run-outfits.sh supabase/tests/020_before_setup.sql supabase/tests/outfits_test_helpers.sql supabase/tests/020_outfit_schema.test.sql
git commit -m "feat: add outfit schema with owner-bound foreign keys and RLS"
```

---

### Task 5: サマリーの作り直しと派生値（021）

**Files:**
- Create: `supabase/migrations/021_outfit_stats_functions.sql`
- Test: `supabase/tests/021_outfit_stats.test.sql`

**Interfaces:**
- Produces（すべて内部用。`public, anon, authenticated` から `execute` を取り上げ、**どのロールにも許可しない**。呼ぶのは、`security definer` の RPC（持ち主の postgres の権限で動く）と、024 の初期集計（SQL Editor の postgres）だけ。サーバーから直接呼ぶ入口は、このプランでは作らない）：
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

`rebuild_all_stats`：最初に `outfit_lock_user(p_user)` をかける（同じトランザクションの中では、何度かけても止まらない）。そのユーザーのサマリーを全部消したあと、次を行う。
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
-- ok: authenticated・anon・service_role のどれから rebuild_monthly_stats・rebuild_all_stats・recompute_item_wear を呼んでも insufficient_privilege
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

### Task 6a: コーデの下書きと確定・編集の RPC（022）

**Files:**
- Create: `supabase/migrations/022_outfit_rpcs.sql`
- Create: `supabase/tests/concurrency/`（同時実行のテストの SQL。`run-outfits.sh` から呼ぶ）
- Modify: `supabase/tests/run-outfits.sh`（同時実行のテストを足す）
- Test: `supabase/tests/022_outfit_confirm.test.sql`

**Interfaces:**
- Consumes: Task 5 の内部関数
- Produces（`authenticated` に `execute` を許可する。どれも最初に `outfit_lock_user(auth.uid())`。`auth.uid()` が null なら例外）：
  - `public.create_outfit_draft(p_client_request_id uuid, p_worn_on date, p_source text) returns public.outfits`：同じ `(user_id, client_request_id)` があればそれを返す
  - `public.confirm_outfit(p_outfit_id uuid, p_expected_revision integer, p_worn_on date, p_item_ids uuid[], p_note text) returns jsonb`：`{ "status": "confirmed" | "unchanged" | "stale", "revision": int }`

例外は `raise exception using errcode = 'P0002', message = 'outfit_not_found'` のように、決まった message にする。message は `outfit_not_found`、`item_not_found`、`invalid_revision`、`not_authenticated`（Task 6b も同じものを使う）。

用語：「今の服」は、今の `outfit_items` の服。「新しい服」は、`p_item_ids` を重複なしにしたもの。「外す服」は今の服にだけある服、「足す服」は新しい服にだけある服、「残す服」は両方にある服。

「記録をつなぐ」とは（足す服と、日付を変えたときの残す服で使う）：
- その服の、新しい日付（日本時間）の `wear_today` の記録で、どの `outfit_items` からも参照されていないものが1件でもあれば、いちばん古いものを使う。
- なければ、`source = outfit`、`worn_at = outfit_worn_at(新しい日付)` の記録を作る。

`confirm_outfit` の手順（仕様書 6.2 章の表のとおり）：

```text
1. p_expected_revision が null か負なら invalid_revision。
   ロック → outfits を user で for update 取得（なければ outfit_not_found）
   p_expected_revision > revision なら invalid_revision（中身が同じでも。次の 3 より先に確かめる）
2. 新しい服のどれかが本人の服でなければ item_not_found。足す服がしまった服（archived_at あり）でも item_not_found
3. 状態が confirmed で、worn_on・服の集合・note が今と同じなら {unchanged, 今の revision} を返す
   （p_expected_revision が今と同じか古くてもよい。応答だけが失われた送り直しを、古い版として拒否しないため）
4. p_expected_revision < revision なら {stale, revision} を返す
5. 影響する月 = 元の worn_on の月（確定済みのとき）と、新しい worn_on の月
6. 外す服：outfit_items の行を消す（source にかかわらず）。
   つながっていた記録が source=outfit なら、その記録も消す。wear_today なら残す
7. 残す服（日付が変わったときだけ）：
   - 新しい日付に、つなげる wear_today（「記録をつなぐ」の1つ目）があるとき：
     今の記録が source=outfit なら消し、wear_today なら残す。wear_log_id をその wear_today に付け替える
   - ないとき：今の記録が source=outfit なら worn_at = outfit_worn_at(新しい日付) に直す（新しい記録は作らない）。
     wear_today なら、残してつながりを外し、source=outfit の記録を作ってつなぐ
8. 足す服：outfit_items の行を作り（source='manual'）、「記録をつなぐ」でつなぐ
9. outfits を更新する
   - status=confirmed、worn_on、note、revision+1、confirmed_at=coalesce(confirmed_at, now())、updated_at=now()
10. recompute_item_wear(今の服 ∪ 新しい服) → 影響する月を rebuild_monthly_stats
11. {confirmed, 新しい revision} を返す
```

確定のあとは、いつも次が成り立つ（テストで毎回確かめる）：
- `outfit_items` の服の集合が、新しい服と完全に一致する。
- どの行にも `wear_log_id` があり、その記録はその服のもので、日本時間の日付が `worn_on` と同じ。

- [ ] **Step 1: 失敗するテストを書く**（`022_outfit_confirm.test.sql`）

```sql
-- 下書き
-- ok: 同じ client_request_id の create_outfit_draft は同じ id を返し、行は1件
-- 確定
-- ok: 初めての確定は {confirmed, 1}、服ごとに source=outfit の記録が1件、worn_at は 12:00 JST
-- ok: 同じ日の未使用の wear_today の記録があれば、それを使う（記録が増えない）
-- ok: 同じ内容をもう一度（expected 0 でも 1 でも）送ると {unchanged, 1}、記録は増えない         ← Review Focus 2
-- ok: 古い版から別の内容を送ると {stale, 2}、何も変わらない
-- ok: expected が null・-1・今より大きい版なら invalid_revision で、何も変わらない
-- ok: 中身が今と同じでも、expected が 999 なら unchanged ではなく invalid_revision
-- ok: 服を外すと、その服の outfit_items の行が消える。source=outfit の記録は消え、使っていた wear_today の記録は残る
-- ok: 服を外したあと、外した服を含む組み合わせ（item_pair_monthly_stats）と、元の服の集合の combo の行が消える
-- ok: 服を足すと、outfit_items の行ができ、その服の記録がつながる
-- ok: 日付を 10/31 → 11/2 に変えると、source=outfit の記録の worn_at が直り（記録の件数は同じ）、10月と11月の両方のサマリーが変わる
-- ok: 日付を変えた先の日に、残す服の未使用の wear_today があれば、それにつなぎ替え、source=outfit の記録は消える
-- ok: 最新の着用を過去の日付に直すと、last_worn_at がほかの記録の最新に戻る
-- ok: どの確定・編集のあとも、上の2つの「いつも成り立つこと」が成り立つ（確かめる関数を作って毎回呼ぶ）
-- ok: B の服を入れると item_not_found で、何も書き込まれない（revision も記録も変わらない）       ← Review Focus 3
-- ok: 存在しない服の id を入れても item_not_found
-- ok: しまった服を新しく足すと item_not_found
-- ok: B のコーデを A が確定しようとすると outfit_not_found
-- 権限
-- ok: anon は create_outfit_draft・confirm_outfit を呼べない
```

同時実行のテスト（`run-outfits.sh` に足す。すべてのテストのファイルのあとに、ユーザー C の commit 済みデータで動かす）：
- 進め方は3つとも同じ。
  1. 接続1を裏で動かす：`begin;` → C として操作1 → `pg_sleep(3)` → `commit;`。
  2. `pg_locks` で接続1が advisory lock を持ったことを確かめてから（最大5秒待つ）、接続2を始める。
  3. 接続2が `pg_stat_activity` でロック待ち（`wait_event_type = 'Lock'`）になったことを確かめる。
  4. 両方が終わったら、postgres で結果を確かめる。
- ケース：
  - 同じコーデを、どちらも expected 0 で、違う服の集合で確定する → 片方は `{confirmed, 1}`、もう片方は `{stale, 1}`。`outfit_items` は先に確定した集合と一致する。`ok: 同時に確定しても、あとの方は stale になる`
  - 同じ日の別々のコーデ2つに、未使用の wear_today がある服 T を入れて同時に確定する → 一意制約のエラーにならず、wear_today は片方だけにつながり、もう片方は source=outfit の記録になる。`ok: 同時に確定しても、同じ記録を2つのコーデで使わない`

- [ ] **Step 2: テストが失敗することを確かめる**

Run: `bash supabase/tests/run-outfits.sh`
Expected: FAIL（`function public.create_outfit_draft(...) does not exist`）

- [ ] **Step 3: `022_outfit_rpcs.sql` を書く**

- [ ] **Step 4: テストが通ることを確かめる**

Run: `bash supabase/tests/run-outfits.sh`
Expected: すべて `ok:`（同時実行の2行を含む）

- [ ] **Step 5: コミットする**

```bash
git add supabase/migrations/022_outfit_rpcs.sql supabase/tests/022_outfit_confirm.test.sql supabase/tests/concurrency supabase/tests/run-outfits.sh
git commit -m "feat: add outfit draft and confirm RPCs with revisions and wear-log reuse"
```

---

### Task 6b: コーデの削除、今日着た、服の完全な削除の RPC（022 に足す）

**Files:**
- Modify: `supabase/migrations/022_outfit_rpcs.sql`
- Modify: `supabase/tests/run-outfits.sh`（同時実行のテストを足す）
- Test: `supabase/tests/022_outfit_delete.test.sql`

**Interfaces:**
- Consumes: Task 5 の内部関数、Task 6a の例外の message
- Produces（`enqueue_media_deletion` 以外は `authenticated` に `execute` を許可する。どれも最初に `outfit_lock_user(auth.uid())`）：
  - `public.delete_outfit(p_outfit_id uuid) returns void`
  - `public.record_wear_today(p_item_id uuid) returns jsonb`：`{ "created": boolean }`
  - `public.hard_delete_item(p_item_id uuid) returns void`
  - `public.enqueue_media_deletion(p_user uuid, p_provider text, p_asset_id text) returns void`（内部用。どのロールにも許可しない。`on conflict do nothing`。Task 7 も使う）

- `delete_outfit`：本人のコーデかを確かめる（違えば `outfit_not_found`）。影響する月を集める。source=outfit の記録を消す。メディアを `enqueue_media_deletion` に入れる。コーデを消す（メディアの行と outfit_items は cascade）。そのあと `recompute_item_wear` と、月の作り直しを行う。
- `record_wear_today`：本人のしまっていない服でなければ `item_not_found`。日本時間の今日の記録がすでにあれば `{created:false}`。なければ `source=wear_today`、`worn_at=now()` で作り、派生値と今月を作り直す。
- `hard_delete_item`：本人の服でなければ `item_not_found`。影響する月（記録の月と、確定済みコーデの月）を先に集める。`outfit_items` からその服の行を消す。服を消す。月を作り直す。コーデは消さない。

- [ ] **Step 1: 失敗するテストを書く**（`022_outfit_delete.test.sql`）

```sql
-- ok: delete_outfit で source=outfit の記録は消え、wear_today の記録は残る。メディアの asset が削除待ちに入る
-- ok: delete_outfit のあと、そのコーデの月のサマリーから、そのコーデの分が消える
-- ok: B のコーデを A が delete_outfit すると outfit_not_found で、何も消えない
-- ok: record_wear_today は1日1回だけ作り、2回目は {created:false}
-- ok: record_wear_today はしまった服・B の服なら item_not_found
-- ok: hard_delete_item でコーデは残り、ほかの服の組み合わせのサマリーは残る。消した服の行はサマリーから消える
-- ok: authenticated・anon・service_role から enqueue_media_deletion を呼ぶと insufficient_privilege
-- ok: anon は delete_outfit・record_wear_today・hard_delete_item を呼べない
```

同時実行のテスト（Task 6a と同じ進め方）：
- 接続1：C として `record_wear_today(T)`。接続2：C として、T を含む今日のコーデを `confirm_outfit`。
- 終わったら postgres で、T の今日の記録が1件だけで、それがコーデにつながり、`wear_count` が記録の件数と同じことを確かめる。
- 表示：`ok: 同時に「今日着た」と確定をしても、記録が二重にならない`

- [ ] **Step 2: テストが失敗することを確かめる**

Run: `bash supabase/tests/run-outfits.sh`
Expected: FAIL（`function public.delete_outfit(uuid) does not exist`）

- [ ] **Step 3: `022_outfit_rpcs.sql` に足す**

- [ ] **Step 4: テストが通ることを確かめる**

Run: `bash supabase/tests/run-outfits.sh`
Expected: すべて `ok:`（同時実行の3行を含む）

- [ ] **Step 5: コミットする**

```bash
git add supabase/migrations/022_outfit_rpcs.sql supabase/tests/022_outfit_delete.test.sql supabase/tests/concurrency supabase/tests/run-outfits.sh
git commit -m "feat: add outfit delete, wear-today and hard-delete RPCs"
```

---

### Task 7: メディアと削除待ちの RPC（023）

**Files:**
- Create: `supabase/migrations/023_outfit_media_rpcs.sql`
- Test: `supabase/tests/023_outfit_media_rpcs.test.sql`

**Interfaces:**
- Consumes: Task 5・6b の `outfit_lock_user`、`enqueue_media_deletion`
- Produces（すべてサーバー専用。`service_role` にだけ `execute` を許可する。どれも最初に、持ち主のユーザーで `outfit_lock_user`）：
  - `public.register_outfit_media(p_user_id uuid, p_media_id uuid, p_outfit_id uuid, p_kind text, p_provider text, p_asset_id text, p_upload_expires_at timestamptz, p_taken_at timestamptz, p_sort_order integer) returns public.outfit_media`
    - コーデが `p_user_id` のものでなければ `outfit_not_found`。
    - 同じ `p_media_id` がすでにあるとき：
      - 他人の行、または `outfit_id`・`kind`・`provider` のどれかが違う行なら、message `media_conflict` の例外にする（同じ本人の別のコーデのメディア ID を使い回させない）。
      - すべて同じなら、何も変えずにその行を返す（`provider_asset_id` は呼んだ側の ID と違うことがある。Task 8 がそれで同時の開始を見分ける）。
    - 種類が photo で、コーデの `analysis_media_id` が null なら、それにする。
  - 次の2つは、`p_expected_upload_attempt` が今の `upload_attempt` と同じときだけ書き込む。違えば message `media_attempt_changed` の例外にする（別の処理が先に置き換えた。Cloudflare で確かめた実体が、もう今の試行ではない）。行が `p_user_id` のものでなければ `media_not_found`。
    - `public.replace_outfit_media_asset(p_user_id uuid, p_media_id uuid, p_expected_upload_attempt integer, p_asset_id text, p_upload_expires_at timestamptz) returns public.outfit_media`
      - ロックを取ったあと、今の状態が `processing` か `ready` なら、何も変えずにその行を返す（削除待ちにも入れない）。送り直しが実体を確かめたあとに、完了の知らせが同じ試行を先に ready にした場合、届いた写真を消さないため。
      - `uploading` か `failed` のときだけ、古い ID を `enqueue_media_deletion` に入れ、新しい ID に置き換え、`upload_attempt + 1`、`status = 'uploading'` にする。
    - `public.set_outfit_media_state(p_user_id uuid, p_media_id uuid, p_expected_upload_attempt integer, p_status text, p_width integer, p_height integer, p_duration_sec numeric) returns public.outfit_media`
      - 許可する変化：`uploading → processing | ready | failed`、`processing → processing | ready | failed`、`ready → ready`。同じ状態への変化は、完了の知らせの送り直しのため。
      - それ以外は message `invalid_media_transition` の例外にする。`failed` から戻すのは `replace_outfit_media_asset` だけ。
  - `public.apply_stream_webhook(p_asset_id text, p_status text, p_width integer, p_height integer, p_duration_sec numeric) returns text`
    - `p_status` は Task 3 の `mapStreamState` で直したもの（`processing`・`ready`・`failed`）。ほかの値は例外。
    - `provider = 'cf_stream'` で、今の `provider_asset_id` が一致する行がなければ `'ignored'`（古い試行の通知もここに入る）。
    - 行があれば、その行の `user_id` で `outfit_lock_user` してから読み直す。
    - 今の状態が `p_status` と同じなら `'duplicate'`。
    - 今の状態が `ready` か `failed` なら、何も変えずに `'ignored'`（遅れて届いた通知で、終わった状態を戻さない）。
    - それ以外（`uploading`・`processing`）は `p_status` と寸法・長さを書いて `'applied'`。
  - `public.claim_media_deletions(p_limit integer) returns setof public.media_deletion_queue`
    - 対象：`done_at is null`、`next_attempt_at <= now()`、`attempts < 10`、`lease_until is null or lease_until < now()`。
    - `for update skip locked` で取り出し、新しい `claim_token = gen_random_uuid()` と `lease_until = now() + interval '5 minutes'` を書いて返す。
  - `public.finish_media_deletion(p_id uuid, p_claim_token uuid, p_ok boolean, p_error text) returns boolean`
    - `claim_token` が一致しなければ何もせず false を返す。一致したら `claim_token` と `lease_until` を null に戻して true を返す。
    - 成功なら `done_at = now()`。
    - 失敗なら `attempts + 1` と `last_error` を記録し、`next_attempt_at` を延ばす。延ばす幅は、`attempts` が1なら1分、2なら10分、3なら1時間、4以上なら1日。

- [ ] **Step 1: 失敗するテストを書く**（`023_outfit_media_rpcs.test.sql`）

```sql
-- 操作は set local role service_role で行う（サーバーと同じ）
-- ok: service_role から register_outfit_media・replace・set_state・apply_stream_webhook・claim・finish が実際に成功する
-- ok: register_outfit_media は B のコーデに A の user_id で登録しようとすると outfit_not_found
-- ok: 同じ media_id・同じコーデで2回呼ぶと行は1件で、2回目に別の asset ID を渡しても、返る行の provider_asset_id は1回目のまま
-- ok: B の media_id を A の user_id で呼ぶと media_conflict
-- ok: A のコーデ X の media_id を、A のコーデ Y で登録しようとすると media_conflict（kind が違っても同じ）
-- ok: 最初の写真が analysis_media_id になり、2枚目では変わらない
-- ok: 同じ provider_asset_id を別のメディアに登録すると一意制約で失敗する
-- ok: replace_outfit_media_asset（expected 1）で古い ID が削除待ちに入り、upload_attempt が 2 になる
-- ok: replace_outfit_media_asset を expected 1 のままもう一度呼ぶと media_attempt_changed で、新しい ID は入らず、削除待ちも増えない
-- ok: 状態が ready（または processing）のメディアに replace_outfit_media_asset（expected は今の試行）を呼ぶと、行は変わらず（provider_asset_id・upload_attempt・status がそのまま）、削除待ちも増えない
-- ok: set_outfit_media_state を古い expected で呼ぶと media_attempt_changed で、状態は変わらない
-- ok: set_outfit_media_state：processing → processing と ready → ready は通る。ready → uploading と failed → ready は invalid_media_transition
-- ok: apply_stream_webhook：古い ID → ignored、今の ID の ready → applied、もう一度 ready → duplicate
-- ok: apply_stream_webhook：ready のあとの processing → ignored で、状態は ready のまま
-- ok: claim_media_deletions は2つの接続から同時に呼んでも、同じ行を二重に返さない（run-outfits.sh で2接続）
-- ok: lease_until の前は取り出されず、lease_until を postgres で過去にすると、別の claim_token で取り出し直せる
-- ok: 古い claim_token の finish_media_deletion は false で、行は変わらない
-- ok: finish_media_deletion の失敗4回目で next_attempt_at が約1日後、10回失敗した行は claim されない
-- ok: authenticated と anon から register_outfit_media・claim_media_deletions・rebuild_monthly_stats を呼ぶと、どれも insufficient_privilege（PUBLIC からの継承も、既定の権限も残っていない）
```

`finish_media_deletion` は、照合と更新を `update ... where id = p_id and claim_token = p_claim_token returning ...` の1つの文で行う。

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
  - `interface OutfitMediaDb { registerMedia(i: { userId: string; mediaId: string; outfitId: string; kind: "photo" | "video"; provider: MediaProvider; assetId: string; uploadExpiresAt: Date; takenAt: Date | null; sortOrder: number }): Promise<OutfitMediaRow>; getMedia(userId: string, mediaId: string): Promise<OutfitMediaRow | null>; replaceAsset(i: { userId: string; mediaId: string; expectedUploadAttempt: number; assetId: string; uploadExpiresAt: Date }): Promise<OutfitMediaRow>; setState(i: { userId: string; mediaId: string; expectedUploadAttempt: number; status: OutfitMediaRow["status"]; width?: number; height?: number; durationSec?: number }): Promise<OutfitMediaRow> }`
    - `media_conflict` と `media_attempt_changed` は、`MediaUploadConflictError` にして投げる（`createSupabaseOutfitMediaDb` とテストのダミーの両方）。
  - `startMediaUpload(deps: { db: OutfitMediaDb; store: MediaStore; now: () => Date }, input: { userId: string; mediaId: string; outfitId: string; kind: "photo" | "video"; takenAt: Date | null; sortOrder: number }): Promise<{ mediaId: string; uploadUrl: string | null }>`
    - `mediaId` はブラウザがファイルごとに作った UUID。
    - `getMedia` で本人の行がすでにあれば、`outfitId` と `kind` が入力と同じか確かめる（違えば `MediaUploadConflictError`。Cloudflare は呼ばない）。同じなら `retryMediaUpload` と同じ処理をする。
    - なければ `createUpload` → `registerMedia` の順に呼ぶ。`registerMedia` が失敗したら、`store.deleteAsset` を一度だけ試してから（失敗しても無視して）、元のエラーを投げ直す。
      - DB には保存できていて、応答だけが失われた場合もこれでよい。ブラウザはアップロード URL を受け取っていないので、消した ID には何も送られていない。次の送り直しで、行の実体が missing とわかり、新しい試行に置き換わる（仕様書 7.4 章）。
    - **同時に2回開始された場合**：`registerMedia` が返した行の `providerAssetId` が、自分が作った ID と違うことがある（もう一方が先に登録した）。そのときは、自分の ID を `deleteAsset` してから `MediaUploadConflictError` を投げる。画面は少し待ってから「もう一度送る」を出す。DB に登録されていない ID へ送らせないため。
  - `class MediaUploadConflictError extends Error`
  - `completeMediaUpload(deps, input: { userId: string; mediaId: string; width?: number; height?: number }): Promise<OutfitMediaRow>`：
    - `getMedia` で今の試行（`uploadAttempt` と `providerAssetId`）を読み、その実体を確かめて、`setState` に `expectedUploadAttempt` を渡す。
    - 写真：実体が ready なら `ready`（ブラウザが知らせた大きさを入れる）。
    - 動画：実体が processing なら `processing`、ready なら `ready`。
    - awaiting_upload か missing なら、`MediaNotUploadedError` を投げる。
    - 確かめているあいだに別の処理が試行を置き換えたら、`setState` が `MediaUploadConflictError` を投げる（古い試行の結果で、新しい試行を ready にしない）。
  - `retryMediaUpload(deps, input: { userId: string; mediaId: string }): Promise<{ mediaId: string; uploadUrl: string | null; row: OutfitMediaRow }>`：
    - `getMedia` で今の試行を読み、その実体を確かめる。
    - 実体が ready か processing なら、`completeMediaUpload` と同じく `setState` して、`uploadUrl: null` を返す。
    - そうでなければ（awaiting_upload でも、期限内でも）、新しいアップロードを作って `replaceAsset` に `expectedUploadAttempt` を渡す。アップロード URL はサーバーに残していないので、前の URL は渡せないため。
    - `replaceAsset` が `MediaUploadConflictError` を投げたら（別の送り直しが先に置き換えた）、自分が作った新しい ID を `deleteAsset` してから、そのエラーを投げ直す。
    - `replaceAsset` が返した行の `providerAssetId` が自分の新しい ID と違い、状態が `processing` か `ready` なら（確かめたあとに、完了の知らせが先に届いた）、自分の新しい ID を `deleteAsset` して、`uploadUrl: null` とその行を返す（もう届いている）。
  - `class MediaNotUploadedError extends Error`
  - `createAdminClient(): SupabaseClient`（`NEXT_PUBLIC_SUPABASE_URL` と `SUPABASE_SECRET_KEY`。セッションは保存しない。サーバーのファイルからだけ import する、とコメントに書く）
  - `createSupabaseOutfitMediaDb(admin: SupabaseClient): OutfitMediaDb`（Task 7 の RPC を呼び、snake_case を camelCase に直す）

- [ ] **Step 1: 失敗するテストを書く**（`OutfitMediaDb` はメモリ上のダミーを、テストファイルの中で作る。ダミーも、別の `outfitId`・`kind` の同じメディア ID と、`expectedUploadAttempt` の食い違いを、Task 7 の RPC と同じく `MediaUploadConflictError` にする。`store` は `createFakeMediaStore()`）

```ts
test("開始：渡されたメディア ID を、Cloudflare のメタデータと DB の両方に使う");
test("開始：同じメディア ID で2回呼ぶと、メディアは1つのままで、Cloudflare に届いていれば uploadUrl は null");
test("開始：DB への保存が失敗したら、作った Cloudflare の ID を deleteAsset してから元のエラーを投げる");
test("開始：DB には保存できて応答だけ失われた場合（ダミーが行を保存してから例外）、次の送り直しで新しい試行になり、upload_attempt は 2");
test("開始：registerMedia が別の asset ID の行を返したら（同時の開始）、自分の ID を消して MediaUploadConflictError");
test("開始：同じ本人の別のコーデのメディア ID なら MediaUploadConflictError で、Cloudflare は呼ばない");
test("開始：アップロード URL の期限は now の30分後");
test("完了：写真の実体が awaiting_upload なら MediaNotUploadedError で、状態は uploading のまま");
test("完了：写真の実体が ready なら ready になり、width・height が入る");
test("完了：動画の実体が processing なら processing。もう一度知らせても processing のまま（エラーにならない）");
test("完了：実体を確かめているあいだに、別の処理が試行を置き換えたら MediaUploadConflictError で、新しい試行は uploading のまま");
// store.getAssetState を、呼ばれたら db.replaceAsset（別の処理）を先に済ませてから ready を返すように差し替えて再現する
test("送り直し：Cloudflare に届いていれば新しい試行を作らず、uploadUrl は null で ready になる");   // ← Review Focus 1
test("送り直し：期限切れ（missing）なら新しい asset を作り、replaceAsset で upload_attempt が増える");
test("送り直し：2つの送り直しが同じ試行を見て、あとの方の replaceAsset が食い違ったら、あとの方が作った ID を消して MediaUploadConflictError。先の方の URL の ID は削除待ちに入らない");
test("送り直し：実体を確かめたあと、完了の知らせが同じ試行を先に ready にしたら、作った新しい ID を消して uploadUrl は null。届いた写真の ID は削除待ちに入らない");
// store.getAssetState を、awaiting_upload を返す前に db.setState(ready) を済ませるように差し替えて再現する
test("他人のメディア ID：getMedia が null なら MediaNotFoundError（Cloudflare は呼ばない）");
```

- [ ] **Step 2: テストが失敗することを確かめる**

Run: `node --test scripts/test-outfit-media-service.mts`
Expected: FAIL（モジュールがない）

- [ ] **Step 3: `media-service.ts`、`media-db.ts`、`admin.ts` を実装する**（`MediaNotFoundError` も `media-service.ts` で export する）

- [ ] **Step 4: テストが通ることを確かめる**

Run: `node --test scripts/test-outfit-media-service.mts`
Expected: PASS（16 tests）

- [ ] **Step 5: コミットする**

```bash
git add lib/outfits/media-service.ts lib/outfits/media-db.ts lib/supabase/admin.ts package.json scripts/test-outfit-media-service.mts
git commit -m "feat: add outfit media upload service with retry that reuses delivered assets"
```

---

### Task 9: 削除待ちの処理と、webhook を DB につなぐ

**Files:**
- Create: `lib/media/deletion-queue.ts`
- Modify: `app/api/webhooks/cloudflare-stream/route.ts`（仮の `apply` を、`createAdminClient().rpc("apply_stream_webhook", { p_asset_id, p_status, p_width, p_height, p_duration_sec })` に置き換える。`p_status` は `handleStreamWebhook` が直したもの）
- Create: `app/api/cron/media-deletions/route.ts`
- Create: `vercel.json`（`{"crons":[{"path":"/api/cron/media-deletions","schedule":"0 18 * * *"}]}`。日本時間の毎日3:00。Vercel の Cron は**本番のデプロイでだけ**動く。プレビューでは動かないので、動くことの確認は Task 12b で行う）
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
- Consumes: Task 5・6b の `rebuild_all_stats`、`record_wear_today`、`hard_delete_item`

本番での順番（Task 12b）：024 は、`actions.ts` を RPC に切り替えたコードが**本番で動いたあと**に適用する。先に 024 を適用すると、今の本番の `recordWearToday`（直接の insert と update）が失敗するため。逆に、新しいコードは 022 がないと動かないので、020〜023 を先に適用する。

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
-- ok: 着用記録のある、コーデに入っていない服を authenticated が直接 delete すると、その服の wear_logs と item_monthly_stats の行も消え、ほかの服の行は変わらない（仕様書 6.3 章の判断の確認）
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

- [ ] **Step 5: 手で確かめる**（`npm run dev`、ローカルは本番 DB につながるので、確かめるのは本番へ適用したあと＝Task 12b）。ここではビルドが通ることまででよい。

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

### Task 12a: 細い1本の流れの画面

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
- Consumes: Task 6a の RPC、Task 8 の `startMediaUpload`・`completeMediaUpload`・`retryMediaUpload`・`MediaUploadConflictError`・`MediaNotUploadedError`・`createSupabaseOutfitMediaDb`・`createAdminClient`、Task 9 の `processMediaDeletionQueue`、Task 2 の `createCloudflareMediaStore`、Task 11 の `aggregatePartners`・`layoutRadialLines`・`jstTodayIsoDate`
- Produces（Server Actions。どれも最初にログインを確かめ、ユーザー ID はサーバーで決める）：
  - アップロードの3つの Action に共通のエラーの言葉：
    - `MediaUploadConflictError` → `{ error: "ほかの送信と重なりました。少し待ってから、もう一度送ってください" }`
    - `MediaNotUploadedError` → `{ error: "写真がまだ届いていません。もう一度送ってください" }`
  - `startOutfitPhotoUpload(input: { clientRequestId: string; mediaId: string; wornOn: string }): Promise<{ outfitId: string; mediaId: string; uploadUrl: string | null } | { error: string }>`
    - `create_outfit_draft`（source は `upload`）のあと `startMediaUpload` を呼ぶ。`takenAt` は null、`sortOrder` は 0。
    - `uploadUrl` が null なら、もう届いているので送らずに完了へ進む。
  - `completeOutfitMedia(input: { mediaId: string; width: number; height: number }): Promise<{ ok: true } | { error: string }>`
  - `retryOutfitMedia(input: { mediaId: string }): Promise<{ uploadUrl: string | null } | { error: string }>`
    - 新しい試行に置き換えたときは、`after(() => processMediaDeletionQueue(...))` で、削除待ちに入った古い ID をすぐ消しにいく（仕様書 6.6 章）。
  - `confirmOutfitAction(input: { outfitId: string; expectedRevision: number; wornOn: string; itemIds: string[]; note: string | null }): Promise<{ status: "confirmed" | "unchanged" | "stale"; revision: number } | { error: string }>`
    - `item_not_found` なら `{ error: "選んだ服が見つかりませんでした。一覧を開き直してください" }`
    - `outfit_not_found` なら `{ error: "このコーデが見つかりませんでした" }`
    - `invalid_revision` なら `{ error: "画面が古くなっています。開き直してください" }`
    - `stale` が返ったら、画面は「ほかの画面で先に変更されました。最新の内容を表示します」と出して、開き直す。
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

- [ ] **Step 3: コミットする**

```bash
git add lib/image-processing.ts "app/(main)/protected/looks" components/outfit-quick-record-form.tsx components/outfit-item-picker.tsx components/relation-lines.tsx "app/(main)/protected/items/[id]/page.tsx"
git commit -m "feat: add thin outfit recording flow with relation lines"
```

---

### Task 12b: 本番への切り替えと、通しの確認（10/31 の到達点）

**Files:**
- Modify: `docs/project/TODO.md`（各段階の結果を記録する）

本番の DB の変更は、ユーザーが SQL Editor で行う。Claude は、各段階で貼るファイルと、そのあとの確認を伝える。どの段階でも、確認が通らなければ先へ進まない。

並び順の理由：
- 020〜023 は足すだけなので、今の本番のコードはそのまま動く。
- 新しいコードは 022 の RPC を使うので、020〜023 のあとに本番へ出す。
- 024 は直接の書き込みを禁止するので、新しいコードが本番で動いたあとに適用する。

- [ ] **Step 1: 020 → 021 → 022 → 023 を本番に適用する（ユーザー）**
  - 1つずつ実行する。どれも `begin;` 〜 `commit;` なので、途中で失敗しても何も残らない。
  - 実行したら、`select to_regclass('public.outfits'), to_regclass('public.media_deletion_queue');` が両方とも null でないことを確かめる。
  - 今の本番のアプリで「今日着た」と服の登録が、今までどおり動くことを確かめる。

- [ ] **Step 2: ローカルで細い流れを確かめる**
  - `npm run dev`（ローカルは本番の DB と、同じ Cloudflare のアカウントにつながる）で、下の Step 6 の確認リストの上から3つを通す。
  - 作ったコーデは、確かめたあと消してよい（消すとメディアは削除待ちに入る）。

- [ ] **Step 3: Vercel の本番の環境変数を入れる（ユーザー）**
  - Task 1 の環境変数を、Production に入れる。`CRON_SECRET` は新しく作る（`openssl rand -hex 32` の出力を、画面に出さずに `.env.local` に書き足すコマンドを Claude が渡す）。`VERCEL_AUTOMATION_BYPASS_SECRET` は入れない。
  - `CLOUDFLARE_STREAM_WEBHOOK_SECRET` は Step 5 のあとで入れ直す。

- [ ] **Step 4: 新しいコードを本番に出す**
  - ユーザーの承認を得てから、ブランチを `main` にマージする（GitHub でプルリクエストを作る。`gh` にログインしていれば Claude が作る）。本番のデプロイが終わるのを待つ。
  - 本番で、「今日着た」と服の削除が動くこと（今は RPC を通る）と、細い流れが動くことを確かめる。

- [ ] **Step 5: 024 を本番に適用し、webhook と Cron を本番に向ける**
  1. 024 の前に、読むだけの確認を SQL Editor で実行し、結果を TODO に記録する。SQL Editor は `raise notice` を表示しないことがあるため、ずれていた服の件数はここで残す。

     ```sql
     -- wear_count か last_worn_at が着用記録と違う服の件数（024 の初期集計で直る）
     select count(*) from public.clothing_items c
     left join lateral (select count(*) n, max(worn_at) m from public.wear_logs w where w.clothing_item_id = c.id) s on true
     where c.wear_count <> s.n or c.last_worn_at is distinct from s.m;
     -- anon に古い書き込み権限が残っていないか（すべて false であること）
     select has_table_privilege('anon', 'public.wear_logs', 'insert'),
            has_table_privilege('anon', 'public.clothing_items', 'insert'),
            has_table_privilege('anon', 'public.clothing_items', 'update');
     ```

     anon の結果に true があれば、024 の前に Claude に知らせる（024 は authenticated だけを締めるため）。
  2. ユーザーが SQL Editor で 024 を実行する。
  3. 本番で、次がすべて今までどおり動くことを確かめる：「今日着た」、服の登録（1着ずつと、写真からまとめて）、服の編集、服の削除、細い流れ。
  4. 服の登録か編集が失敗したら、すぐ次を SQL Editor で実行して元に戻し、Claude に知らせる（列の権限の一覧を直してから、024 を適用し直す）：

     ```sql
     begin;
     grant insert, update on public.clothing_items to authenticated;
     grant insert, update, delete on public.wear_logs to authenticated;
     commit;
     ```

  5. `node --env-file=.env.local scripts/setup-cloudflare.mts --webhook https://<本番のドメイン>/api/webhooks/cloudflare-stream` を実行する。通知先はアカウントに1つなので、プレビューへの通知はここで止まる。本番のドメインには保護を通る設定を付けない。スクリプトは、秘密が前と変わったかどうかだけを表示する。変わっていたら、ユーザーが Vercel の Production の `CLOUDFLARE_STREAM_WEBHOOK_SECRET` を入れ直し、もう一度デプロイする。
  6. Vercel の Settings → Cron Jobs に `/api/cron/media-deletions` が出ていることを確かめ、そこから1回動かして、ログに 200 が出ることを確かめる。
  7. Task 3 で作った `VERCEL_AUTOMATION_BYPASS_SECRET` は、もう使わない。ユーザーが Vercel で取り消してよい。

- [ ] **Step 6: 本番で通しで確かめる**（手動の確認リスト。結果を TODO に記録する）
  - [ ] 服の詳細 →「この服で着画を記録」→ 写真を選ぶ → 送れる。
  - [ ] 別の服を2着足して「確定」→ コーデの画面に写真と3着が出る。
  - [ ] 服の詳細の「よく合わせる服」に、2着への線が出る。
  - [ ] 「確定」を連打しても、着用回数は1回しか増えない。
  - [ ] 送る途中で通信を切り（DevTools の Offline）、戻してから「もう一度送る」で完了する。
  - [ ] 「今日着た」と服の削除が、今までどおり動く。
  - [ ] smoke の動画を送ると、本番の webhook が 200 と `ignored` を返す（メディアの行がないため）。
  - [ ] 服 A の詳細から記録画面を開き、戻って服 B から開き直すと、選ばれているのは B だけ。
  - [ ] 選んだ服を別のタブで削除し、記録画面を開き直すと（一覧を取り直すと）、選択から外れる。別のタブの削除は自動では反映されない。
  - [ ] 記録画面から別の画面へ移って戻っても、写真のプレビューが表示される。
  - [ ] 確定の通信を切って（DevTools の Offline）戻し、もう一度確定すると、服の詳細の着用回数と線が更新される。

- [ ] **Step 7: コミットする**

```bash
git add docs/project/TODO.md
git commit -m "docs: record production rollout of the thin outfit flow"
```

---

## 仕様との対応（このプランで扱わないもの）

| 仕様の項目 | 担当 |
|---|---|
| 解析の実行（`outfit_analysis_runs`）、認識結果（`outfit_detections`）、AI の3段階、本人の選択、正解率 | Plan 2 |
| 撮影画面、EXIF、動画だけの取り込み（`frame`）、動画のアップロードの画面、Stream の状態を画面を開いたときに確かめる処理 | Plan 2 |
| 確認画面、新しく登録（切り出し） | Plan 2 |
| 小物のカテゴリー（仕様書 6.1 章の4か所）。AI が小物を見つけ、新しく登録できるようにするため、確認画面より先に入れる | Plan 2 |
| 候補の順位付けの「グループ」の加点（仕様書 7.5 章）：順位付けの関数はグループを入力に受け取り、加点の計算とテストまで Plan 2 で作る。グループのテーブル（`item_groups`・`item_group_members`）と画面は Plan 4 なので、それまでサーバーは空のグループを渡す（加点は0） | Plan 2（関数）／Plan 4（テーブルと画面） |
| 「＋記録」ボタン、Looks の最低限、確定直後の演出、マップ（タップ・来た道・再生・ドラッグ）、アプリを開いたときの削除待ちの処理 | Plan 3 |
| アーカイブの RPC と画面、自分で付ける関係（グループのテーブル、`set_item_group`、画面）、季節の比較、マップの残りの仕掛け、写真なしで記録、「今日着た」からの提案 | Plan 4 |
