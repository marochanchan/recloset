# 着画 Plan 2a：Webカメラの写真撮影 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 記録画面（`/protected/looks/new`）で、Mac のカメラから着画を撮り、Plan 1 の細い流れ（送る → 確定 → 関係DB → 線）にそのまま載せる。

**Architecture:** カメラは差し替えられる部品（`CameraSource`）の裏に置き、撮影の流れは React に依存しない `CaptureController` にまとめて、ダミーのカメラと `node --test` で試す。React の部品は状態を映すだけにする。撮った写真は `processImageForOutfitUpload` を通して `ProcessedImage` にし、確認画面で「使う」と決めてから、既存の下書き作成へ渡す。サーバー、DB、環境変数は変えない。

**Tech Stack:** Next.js 16（`cacheComponents: true`、Activity）、React 19、MediaDevices API、canvas、Web Audio、`node --test`（型の除去）。新しい依存は足さない。

**Spec:** `docs/superpowers/specs/2026-10-24-chakuga-outfit-relations-design.md`（7.2、10、11.4、12 章）。関連：Plan 1 `docs/superpowers/plans/2026-10-25-chakuga-plan1-foundation-thin-slice.md`。

## このプランで決めたこと

- **範囲は写真だけ**（Ruling 12）：カメラの選択、鏡と同じ左右反転、反転を戻した保存、5秒のカウントダウン（表示と音）、保存か撮り直し、アップロードへの切り替え、差し替えられる合図。動画、動画からの静止画の選択、撮影待機の全画面、「＋記録」ボタン、外部シャッターは入れない。
- **横長のカメラ**：カメラを横に倒して使えるよう、「向きを回す」（90°単位）を付ける。1280×720 で取れるカメラなら 720×1280 の縦長の写真になる。全身が入る距離を取りやすく、`processImage` がもう回転に対応しているので作る量も小さい。拡大はしない。向きはカメラごとに覚える。初期値は回転なし。
- **撮り直しは送らない**：確認画面で「この写真を使う」を押すまで、下書きも Cloudflare の画像も作らない。撮り直しでごみが増えず、上限（Ruling 13、Plan 2 で作る）の数にも入らない。
- **解像度**：`width`・`height` の `ideal` を 3840×2160 で頼み、カメラが出せる大きさのまま受ける（720p なら 1280×720）。保存は既存の長辺2560px・品質0.9。確認画面に実際の大きさを出す。
- **画面に戻っても自動でカメラを点けない**：隠れたら必ず止める。ライトが知らないうちに点いている状態を作らない。
- **カメラの出番が終わる場面**：ファイルを選んだとき、確定のあとフォームをリセットするときは、カメラの部品の `key` を変えて作り直す（アンマウントで止まり、確認中の写真も消える）。`ref` で呼ばない。Activity で隠れている間は `ref` が null になり、確定の完了が隠れている間に来ると空振りするため。
- **映像が届いてから撮れるようにする**：`live` になるのは最初のフレームが届いたあと。
- **本番への出し方**：DB と環境変数の変更はない。ブランチのプレビューで実物を確かめ、PR を承認してもらってマージする。

## Global Constraints

- 着画の写真は、長辺2560px・JPEG・品質0.9 に縮小してから送る（`processImageForOutfitUpload`）。
- 撮影のカウントダウンは5秒。「撮影を始める合図」は差し替えられる部品にする。
- 映像は鏡と同じ左右反転で映す。保存する写真は反転を戻す。
- カメラの許可がない、カメラがないときは、理由を出してアップロードに切り替える。
- TS のテストは `node --test`。テストされる `lib/` のファイルは型の除去で動く書き方だけにする（enum・namespace・コンストラクターの引数のプロパティは使わない）。`@/` の解決は `scripts/test-outfit-media-service.mts` と同じ `registerHooks`。
- テストのファイルは `scripts/test-outfit-camera-*.mts`（`npm run test:outfits` の対象になる）。名前だけのテストや、assert のないテストは残さない。
- 画面の言葉は今のアプリに合わせ、責めない言い方にする。コメントは日本語で、まわりのコードと同じくらいの量にする。
- `npm run dev` は使わない（本番の DB につながる）。`npm run build` は容量を使うので承認なしに流さない（Vercel のプレビューのビルドで確かめる）。`.env.local` は読まない。
- `git add` はファイルを指定する（`-A` と `.` は使わない）。未追跡の `AGENTS.md`・`CLAUDE.md`・`scripts/test-image-analysis.mts` は触らない。
- 各タスクの差分は Codex（Astra xhigh）がレビューする。やりとりはサブエージェント経由。

## Review Focus

1. **開いている途中で閉じる・別のカメラに替える**：あとから届いた映像を必ず止める。ライトが点いたままにならない（Task 2 の「close during open」「switch twice」）。
2. **別の画面へ移る（Activity で隠れる）**：カメラを止める。カウントダウンは撮らずに止まる。確認中の写真は残り、戻っても自動でカメラは点かない（Task 2 の「suspend …」）。
3. **撮影の途中で USB が抜ける**（カウントダウン中、撮影の処理中、開いている途中も）：撮らずに理由を出す。確認中の写真は残る。撮り直しで開き直せる（Task 2 の「ended …」）。
4. **覚えていたカメラが消えた、localStorage が壊れている・使えない**：既定のカメラで始まる（Task 1 の preferences、Task 2 の「remembered gone」）。
5. **合図や「使う」の二重**：カウントダウンはやり直さず、写真は1枚、「使う」は1回だけ写真を返す（Task 2 の「second trigger」「keep once」）。

---

### Task 1: カメラの型と、計算の部分

**Files:**
- Create: `lib/camera/camera-source.ts`
- Create: `lib/camera/camera-preview-layout.ts`
- Create: `lib/camera/camera-preferences.ts`
- Create: `lib/camera/camera-ready-gate.ts`
- Test: `scripts/test-outfit-camera-basics.mts`

**Interfaces:**
- Consumes: `ImageRotation`（`lib/image-processing.ts`）
- Produces:

```ts
// lib/camera/camera-source.ts
export type CameraDevice = { deviceId: string; label: string };
export type CameraErrorReason =
  | "unsupported" | "permission_denied" | "not_found" | "in_use" | "disconnected" | "failed";
export class CameraError extends Error { reason: CameraErrorReason /* name = "CameraError" */ }
export function toCameraError(error: unknown): CameraError;
export function cameraErrorMessage(reason: CameraErrorReason): string;
export interface OpenedCamera {
  deviceId: string;                         // 実際に開いたカメラ
  attach(video: HTMLVideoElement | null): void;
  ready(): Promise<void>;                   // 最初のフレームが届くと解決。再生できなければ CameraError で reject
  capture(): Promise<Blob>;                 // 反転も回転もしていない生のフレーム
  onEnded(listener: () => void): () => void;
  stop(): void;
}
export interface CameraSource {
  isSupported(): boolean;
  open(deviceId: string | null): Promise<OpenedCamera>; // null は既定のカメラ
  listDevices(): Promise<CameraDevice[]>;
  onDevicesChanged(listener: () => void): () => void;
}

// lib/camera/camera-preview-layout.ts
export type PreviewLayout = {
  aspect: number;         // 回転後の 幅/高さ
  widthPercent: number;   // video の幅（外枠の幅に対する%）
  heightPercent: number;  // video の高さ（外枠の高さに対する%）
  transform: string;
};
export function previewLayout(frame: { width: number; height: number }, rotation: ImageRotation): PreviewLayout;

// lib/camera/camera-preferences.ts
export type CameraPreferences = { lastDeviceId: string | null; rotations: Record<string, ImageRotation> };
export type PreferenceStorage = Pick<Storage, "getItem" | "setItem">;
export function loadCameraPreferences(storage: PreferenceStorage | null): CameraPreferences;
export function saveCameraPreferences(storage: PreferenceStorage | null, preferences: CameraPreferences): void;

// lib/camera/camera-ready-gate.ts
export const CAMERA_READY_TIMEOUT_MS = 10_000;
export function createReadyGate(timeoutMs?: number): {
  promise: Promise<void>;             // 待つ人がいなくても未処理の reject にならない
  resolve(): void;                    // 2回目以降は何もしない
  reject(error: CameraError): void;   // 同上
};
```

- [ ] **Step 1: 失敗するテストを書く**（`scripts/test-outfit-camera-basics.mts`。値はこのとおり assert する）

```ts
test("toCameraError maps browser error names", () => {
  // name → reason（new DOMException("x", name) で作る）
  // NotAllowedError, SecurityError → permission_denied
  // NotFoundError, OverconstrainedError → not_found
  // NotReadableError, AbortError → in_use
  // TypeError、文字列、null → failed
  // CameraError はそのまま同じものを返す
});
test("cameraErrorMessage has a message for every reason and none is raw", () => {
  // 6つの reason すべてで空でない日本語。permission_denied と not_found と unsupported は
  // 「写真を選んで」を含む（アップロードへの案内）
});
test("previewLayout: landscape, no rotation", () => {
  // {1280,720}, 0 → aspect 1280/720, widthPercent 100, heightPercent 100,
  // transform "translate(-50%, -50%) scaleX(-1)"
});
test("previewLayout: camera turned sideways", () => {
  // {1280,720}, 90 → aspect 720/1280, widthPercent 1280/720*100, heightPercent 720/1280*100,
  // transform "translate(-50%, -50%) scaleX(-1) rotate(90deg)"（270 も同じ大きさで rotate(270deg)、180 は 100/100）
});
test("preferences round trip", () => {
  // ダミーの storage に保存して読むと同じ。キーは "recloset.camera.v1"
});
test("preferences fall back when storage is broken or unavailable", () => {
  // storage が null、getItem が投げる、壊れた JSON、形が違う JSON（rotations が配列、lastDeviceId が数値）
  // → { lastDeviceId: null, rotations: {} }。rotations の値が 0/90/180/270 以外の行は捨てる
  // setItem が投げても saveCameraPreferences は投げない
});
test("ready gate settles once and clears its timer", () => {
  // mock.method(globalThis, "clearTimeout") で確かめる：resolve でも reject でも、作ったタイマーが解除される
  // resolve のあとの reject は無視する。reject(error) は待っている側に同じ error を渡す
});
test("ready gate times out after 10 seconds", () => {
  // 9999ms では未決着、10000ms で CameraError、reason "failed"
});
test("ready gate never leaves an unhandled rejection", () => {
  // promise を誰も待たずに reject → 本物の setImmediate で数回待ってから、process の unhandledRejection が0回
});
```

- [ ] **Step 2: テストが失敗することを確かめる**

Run: `node --test scripts/test-outfit-camera-basics.mts`
Expected: FAIL（`lib/camera/` のファイルがない）

- [ ] **Step 3: 3つのファイルを作る**

`transform` の並びは上のとおり（CSS は右から順に効くので、回してから映す鏡にする。回転の向きは `processImage` の `context.rotate` と同じ時計回り）。`cameraErrorMessage` の文面：

| reason | 文面 |
|---|---|
| `unsupported` | このブラウザではカメラを使えません。写真を選んで記録できます |
| `permission_denied` | カメラの使用が許可されていません。ブラウザの設定で許可するか、写真を選んで記録できます |
| `not_found` | カメラが見つかりませんでした。つなぎ直すか、写真を選んで記録できます |
| `in_use` | カメラがほかのアプリで使われているようです。閉じてから、もう一度お試しください |
| `disconnected` | カメラとのつながりが切れました。つなぎ直して、もう一度お試しください |
| `failed` | カメラを開けませんでした。時間をおいて、もう一度お試しください |

- [ ] **Step 4: テストが通ることを確かめる**

Run: `node --test scripts/test-outfit-camera-basics.mts`
Expected: PASS

- [ ] **Step 5: コミットする**

```bash
git add lib/camera/camera-source.ts lib/camera/camera-preview-layout.ts lib/camera/camera-preferences.ts lib/camera/camera-ready-gate.ts scripts/test-outfit-camera-basics.mts
git commit -m "feat: add camera types, preview layout and preferences"
```

---

### Task 2: 撮影の流れ（CaptureController）

**Files:**
- Create: `lib/camera/capture-trigger.ts`
- Create: `lib/camera/fake-camera-source.ts`
- Create: `lib/camera/capture-controller.ts`
- Test: `scripts/test-outfit-camera-controller.mts`

**Interfaces:**
- Consumes: Task 1 の型すべて。`ImageRotation`・`ProcessedImage`・`getNextRotation`（`lib/image-processing.ts`）
- Produces:

```ts
// lib/camera/capture-trigger.ts
export type CaptureTrigger = { subscribe(fire: () => void): () => void };
export function createManualTrigger(): CaptureTrigger & { fire(): void }; // 今は PC のボタン

// lib/camera/capture-controller.ts
export const COUNTDOWN_SECONDS = 5;
export type CapturePhase =
  | "off" | "opening" | "live" | "countdown" | "processing" | "review" | "unavailable";
export type CaptureState = {
  phase: CapturePhase;
  secondsLeft: number | null;              // countdown のときだけ
  devices: CameraDevice[];
  deviceId: string | null;
  rotation: ImageRotation;
  photo: ProcessedImage | null;            // review のときだけ（回転まで反映した、保存される写真）
  errorReason: CameraErrorReason | null;   // unavailable のときだけ
  message: string | null;                  // live に戻ったときの一言
};
export type CaptureController = {
  getState(): CaptureState;                // 変わらない間は同じオブジェクトを返す（useSyncExternalStore 用）
  subscribe(listener: () => void): () => void;
  attachVideo(video: HTMLVideoElement | null): void;
  start(): Promise<void>;
  selectDevice(deviceId: string): Promise<void>;
  rotate(): void;                          // live のときだけ効く
  cancelCountdown(): void;
  retake(): Promise<void>;
  keep(): ProcessedImage | null;           // 写真を返して off へ。2回目は null
  suspend(): void;                         // 画面が隠れた。確認中の写真だけ残す
  close(): void;                           // 全部やめる
};
export function createCaptureController(deps: {
  source: CameraSource;
  trigger: CaptureTrigger;
  process: (frame: Blob, rotation: ImageRotation) => Promise<ProcessedImage>;
  storage: PreferenceStorage | null;
  onTick?: (secondsLeft: number) => void;  // 5,4,3,2,1,0。音に使う
}): CaptureController;

// lib/camera/fake-camera-source.ts
export type FakeOpenedCamera = OpenedCamera & {
  stopped: boolean; captureCount: number; endNow(): void; failNextCapture(): void;
  holdCapture(): (error?: unknown) => void; // 次の capture を止める。返した関数で完了させる（error を渡すと失敗）
  holdReady(): (error?: unknown) => void;   // ready を止める。使い方は同じ
};
export function createFakeCameraSource(options?: { devices?: CameraDevice[]; supported?: boolean }): CameraSource & {
  openCalls: (string | null)[];      // open に渡された ID（順に）
  opened: FakeOpenedCamera[];        // 開けたカメラ（順に）
  failNextOpen(error: unknown): void;
  holdNextOpen(): (error?: unknown) => void;  // 次の open を止める。返した関数で完了させる（error を渡すと失敗）
  holdNextReady(): (error?: unknown) => void; // 次に開くカメラの ready を止める
  holdNextListDevices(): () => void;          // 次の listDevices を止める
  setDevices(devices: CameraDevice[]): void; // onDevicesChanged の登録先を呼ぶ
};
```

- [ ] **Step 1: 失敗するテストを書く**（`scripts/test-outfit-camera-controller.mts`）

カウントダウンは `mock.timers.enable({ apis: ["setTimeout"] })`。タイマーは1秒ずつつながるので、`tick(4000)` のように一度に進めると1段しか進まない。必ず補助関数 `advanceSeconds(n)`（`tick(1000)` と Promise を流す `await flush()` を n 回。`flush` は本物の `setImmediate` で数回待つ）を使う。下の表の時間はすべてこの補助関数で進める。`process` のダミーは、受け取った引数を記録して `{ blob, width: 1280, height: 720 }` を返す。完了を遅らせる版も用意する。

| テスト名 | 確かめること |
|---|---|
| `start opens the default camera` | `openCalls` が `[null]`。phase `live`、`devices` が入り、`deviceId` は開いたカメラ。`lastDeviceId` が保存される |
| `start reopens the remembered camera` | 保存済みの ID で open し、そのカメラの回転が `rotation` に入る |
| `remembered gone: falls back to the default camera` | 1回目の open が `not_found` → `openCalls` が `["x", null]`、phase `live` |
| `live only after the first frame` | `holdNextReady` の間は `opening`。完了させると `live` |
| `close while waiting for ready` | `holdNextReady` → `close()` → stopped、phase `off`。あとから完了しても失敗しても `off` のまま |
| `ended while waiting for ready` | `holdNextReady` → `endNow()` → `unavailable`、`disconnected`。あとから完了しても `live` にならない |
| `ready failure stops the camera` | ready が `CameraError("failed")` → stopped、`unavailable`、`failed`。`lastDeviceId` は保存しない |
| `unsupported never calls open` | `supported: false` → `unavailable`、reason `unsupported`、`openCalls` は空 |
| `permission denied, then start again works` | `NotAllowedError` → `permission_denied`。もう一度 `start()` で `live` |
| `countdown shows 5 to 1, then captures once` | `fire()` → countdown・`secondsLeft` 5。4秒後に 1、撮っていない。5秒で `captureCount` 1、`processing` → `review`。`process` に今の `rotation` が渡る |
| `onTick order` | `[5,4,3,2,1,0]` |
| `second trigger does not restart the countdown` | 2秒後にもう一度 `fire()`。合計5秒で1回だけ撮る |
| `trigger is ignored outside live` | off、processing、review で `fire()` しても何も変わらない |
| `cancelCountdown returns to live and never captures` | 10秒進めても `captureCount` 0 |
| `capture failure returns to live with a message` | `failNextCapture` → `live`、`message` は「撮れませんでした。もう一度お試しください」。`process` の失敗も同じ |
| `retake while the stream is alive` | `live`、`photo` は null、open は増えない |
| `keep once` | 1回目は写真を返し、カメラは stopped、phase `off`。2回目は null |
| `close during open stops the late stream` | `holdNextOpen` → `close()` → 完了させる → そのカメラは stopped、phase `off` |
| `switch twice: only the last camera stays` | 2つの `selectDevice` を重ねる。先の完了が後でも、残るのは最後のカメラだけ。ほかは stopped |
| `late failure of a replaced open is ignored` | 先の open を止めたまま次のカメラへ替え、`live` になってから先の open を失敗させる → `live` のまま、`errorReason` は null |
| `failed switch keeps the last good camera remembered` | `selectDevice` が `in_use` → `unavailable`。`lastDeviceId` は前のまま。`start()` で前のカメラが開く |
| `suspend during countdown` | stopped、phase `off`、時間が過ぎても撮らない |
| `suspend during processing drops the result` | `process` の完了を遅らせて suspend → phase `off`、`photo` は null |
| `suspend during review keeps the photo` | phase `review`、stopped。`retake()` で open がもう1回呼ばれ `live` |
| `ended during countdown` | `endNow()` → `unavailable`、`disconnected`、時間が過ぎても撮らない |
| `ended during processing` | `process` を遅らせて `endNow()` → `unavailable`、`disconnected`。あとから `process` が終わっても `photo` は null のまま |
| `ended during capture` | `holdCapture` の間に `endNow()` → `unavailable`、`disconnected`。あとから capture が失敗しても `message` は入らない |
| `ended while opening` | `holdNextListDevices` の間に `endNow()` → `unavailable`、`disconnected`。完了しても `live` にならない |
| `ended during review keeps the photo` | phase `review` のまま。`retake()` で開き直す |
| `rotate is remembered per camera` | 0 → 90 を保存。別のカメラは 0 のまま。戻すと 90。countdown 中は変わらない |
| `device list follows changes while open` | `setDevices` で `devices` が変わる。`close()` のあとは登録が消えている |
| `trigger is unsubscribed after close` | `close()` のあと `fire()` しても何も起きない（`subscribe` の解除が1回呼ばれる） |
| `getState is stable between changes` | 変化がなければ同じオブジェクト。変化のたびに `subscribe` の相手が呼ばれる |

- [ ] **Step 2: テストが失敗することを確かめる**

Run: `node --test scripts/test-outfit-camera-controller.mts`
Expected: FAIL（ファイルがない）

- [ ] **Step 3: `capture-trigger.ts`・`fake-camera-source.ts`・`capture-controller.ts` を作る**

- 開くたび・止めるたびに世代の番号を増やす。`await` のあとは、**成功でも失敗（catch）でも**番号を比べ、古ければ状態を変えない。成功で届いたカメラは `stop()` する（`start`、`selectDevice`、`ready`、`listDevices`、撮影の `capture` と `process` のすべて）。
- `start`：`isSupported` が false なら `unavailable`。`open(保存した ID)`。`not_found` で ID があれば `open(null)` をもう1回だけ。成功したら `attach`、`onEnded` と `onDevicesChanged` を登録 → `ready`（失敗は止めて `unavailable`）→ `listDevices`（失敗は `[]`）→ `trigger` を登録 → `live` → `lastDeviceId` を保存。`ready` の失敗で `lastDeviceId` を残さない。
- `onEnded`：`review` なら止める処理を通して写真を残す。それ以外（`opening`・`live`・`countdown`・`processing`）は、止める処理を通して `unavailable`・`disconnected` にする。
- カウントダウンは1秒の `setTimeout` のつなぎ。`onTick` の例外は握りつぶす（音の失敗で撮影を止めない）。
- 止める処理を1か所にまとめる（タイマー、登録の解除、`stop()`、世代を増やす）。`suspend`、`close`、`keep`、`selectDevice`、`onEnded` はこれを使う。
- 状態は毎回新しいオブジェクトに置き換える。

- [ ] **Step 4: テストが通ることを確かめる**

Run: `node --test scripts/test-outfit-camera-controller.mts`
Expected: PASS

- [ ] **Step 5: コミットする**

```bash
git add lib/camera/capture-trigger.ts lib/camera/fake-camera-source.ts lib/camera/capture-controller.ts scripts/test-outfit-camera-controller.mts
git commit -m "feat: add capture controller with countdown and camera races"
```

---

### Task 3: 本物のカメラと画面

ここは React と実物の API の薄い層なので、自動テストはなく、Task 4 の手動の確認で確かめる。流れの判断をこの層に書かない（判断が要るなら Task 2 へ戻す）。

**Files:**
- Create: `lib/camera/browser-camera-source.ts`
- Create: `lib/camera/countdown-beep.ts`
- Create: `components/outfit-camera-capture.tsx`
- Modify: `components/outfit-quick-record-form.tsx:163-195`（新しい下書きを作る部分を切り出す）、`:263-286`（撮影の部品を置く）

**Interfaces:**
- Consumes: Task 1・2 のすべて。`processImageForOutfitUpload`
- Produces:

```ts
// lib/camera/browser-camera-source.ts
export function createBrowserCameraSource(): CameraSource;
// lib/camera/countdown-beep.ts
export function createCountdownBeep(): { prepare(): void; beep(secondsLeft: number): void; dispose(): void };
// components/outfit-camera-capture.tsx
export function OutfitCameraCapture(props: {
  disabled: boolean;
  onPhoto: (image: ProcessedImage) => void;
}): React.ReactNode;
```

- [ ] **Step 1: `browser-camera-source.ts` を作る**

- `isSupported`：`window.isSecureContext` かつ `navigator.mediaDevices?.getUserMedia`。
- `open`：`{ audio: false, video: { deviceId: id ? { exact: id } : undefined, width: { ideal: 3840 }, height: { ideal: 2160 } } }`。例外は `toCameraError`。`deviceId` は `track.getSettings().deviceId`。
- `ready`：`getUserMedia` が映像を返したときに `createReadyGate()` を作り（10秒は許可を待つ時間を含まない）、その `promise` を返す。`attach` より先に呼ばれてもよい。つないだ `video` で `loadeddata` が来れば `resolve`。`play()` が `AbortError` 以外で失敗したら `CameraError("failed")` で `reject`。
- `stop`：`loadeddata` の登録を外し、未決着の `ready` は `CameraError("failed")` で `reject` して決着させる。
- `capture`：トラックが `live`、`videoWidth`・`videoHeight` が 0 より大きい、`readyState >= HTMLMediaElement.HAVE_CURRENT_DATA` のどれかを満たさなければ `CameraError("failed")` で reject。その大きさの canvas に**そのまま** `drawImage` する（反転は CSS だけなので、ここでは何もしない）。`toBlob("image/jpeg", 0.98)`。使い終わった canvas は幅と高さを 0 にする。
- `attach`：`srcObject` を付け外しして `play()`（結果は `ready` に渡す）。`stop`：全トラックを止め、`srcObject` を外す。
- `listDevices`：`videoinput` だけ。`label` が空なら `カメラ 1` のように番号を付ける。

- [ ] **Step 2: `countdown-beep.ts` を作る**

`prepare()` は撮影ボタンを押したときに `AudioContext` を作る（ブラウザが音を許す）。`beep(secondsLeft)` は短い音（1〜5 は 660Hz、0 は 880Hz、約0.12秒）。`dispose()` は `AudioContext` を閉じる（次の `prepare()` でまた作る）。どれも全体を try/catch で包み、音が出なくても撮影に影響させない。

- [ ] **Step 3: `outfit-camera-capture.tsx` を作る**

- `controller`・`trigger`・`beep` は、1つの `useState(() => ({ ... }))` でまとめて1回だけ作る（レンダーごとに作り直すと、下の後始末が走ってカメラが止まる）。`onTick` とボタンの `prepare()` は同じ `beep` を使う。`useSyncExternalStore(subscribe, getState, getState)` で状態を読む。`storage` は `typeof window` を確かめ、`try` で `window.localStorage` を取る。
- `useLayoutEffect(() => () => { controller.suspend(); beep.dispose(); }, [controller, beep])`：Activity で隠れたとき、アンマウントのときに止める。
- 確認の写真の表示 URL は、フォームの `previewBlob` と同じ作り（effect で作って解放する）。
- `video` は `playsInline muted`、`phase` が opening・live・countdown・processing の間は表示し続ける（review は隠す。映像は止めない）。`onLoadedMetadata` で `videoWidth`・`videoHeight` を state に入れ、`previewLayout` に渡す（分かるまでは 1280×720 として扱う）。
- 外枠：`position: relative; overflow: hidden; width: min(100%, calc(70vh * <aspect>)); aspect-ratio: <aspect>`。`video`：`position: absolute; top: 50%; left: 50%; width: <widthPercent>%; height: <heightPercent>%; max-width: none; transform: <transform>`。`max-width: none` は省かない（Tailwind の土台の `video { max-width: 100% }` が効くと、90°・270° の映像が潰れる）。
- ボタンと文言：

| phase | 出すもの |
|---|---|
| off | 「カメラで撮る」 |
| opening | 「カメラを準備しています」、「閉じる」（許可の確認中でもやめられる） |
| live | カメラの選択（`<select>`、見た目は `Input` と同じ。2台以上のときだけ）、「向きを回す」、「5秒後に撮る」、「閉じる」。`message` があれば `role="status"` |
| countdown | 映像の上に大きな数字（`aria-live="assertive"`）、「やめる」 |
| processing | 「写真を整えています」 |
| review | 保存される写真（反転なし）、`1280×720` のような大きさ、「この写真を使う」「撮り直す」 |
| unavailable | `role="alert"` で `cameraErrorMessage`、「もう一度」（`start()`）、ファイルの欄はフォームにそのまま残る |

- 「5秒後に撮る」は `beep.prepare()` のあと `trigger.fire()`。`onTick` に `beep.beep` を渡す。
- `disabled` が true のとき：「カメラで撮る」と「この写真を使う」を押せなくする。

- [ ] **Step 4: フォームにつなぐ**

- `handleFileChange` の「処理に成功してから、下書きごと作り直す」の部分を `beginDraft(image: ProcessedImage)` に切り出す。ファイルの流れの動きは変えない。
- `handleCameraPhoto(image)`：`isConfirmingRef.current` か、`phase` が processing・uploading なら何もしない。それ以外は `setMessage(null)` のあと `beginDraft(image)`。
- `const [cameraKey, setCameraKey] = useState(0)` を足す。`handleFileChange` で、ファイルがあり確定中でないことを確かめたすぐあとに `setCameraKey((k) => k + 1)`（カウントダウンも確認中の写真もやめる）。`resetForm` でも同じ（確定のあとに写真が残らない。隠れている間に確定が終わっても効く）。`clientRequestId`・`mediaId`・`processedRef`・`mediaIdRef` の扱いは変えない。
- 見出しを「1. 着画を撮る・選ぶ」にする。`<OutfitCameraCapture key={cameraKey} disabled={isConfirming || phase === "processing" || phase === "uploading"} onPhoto={handleCameraPhoto} />` を、ファイルの欄の上に置く。ファイルの欄は常に残す。

- [ ] **Step 5: 型とリントとテストを確かめる**

Run: `npx tsc --noEmit && npx eslint app components lib scripts && npm run test:outfits`
Expected: 型のエラーなし。リントは今の警告から増えない（`npm run lint` は `.next/` まで見てしまうので使わない）。テストはすべて合格（既存の102件＋カメラの分）。

- [ ] **Step 6: コミットする**

```bash
git add lib/camera/browser-camera-source.ts lib/camera/countdown-beep.ts components/outfit-camera-capture.tsx components/outfit-quick-record-form.tsx
git commit -m "feat: capture outfit photos from the webcam"
```

---

### Task 4: 実物のカメラで確かめて、本番へ

コードは足さない（直すときは Task 2・3 に戻る）。Claude はブランチを push し、確認リストを渡し、ユーザーが実物で確かめる。

**Files:**
- Create: `.superpowers/sdd/2026-10-31-chakuga-plan2a-webcam-photo/preview-check.md`（確認リストと結果）
- Modify: `docs/project/TODO.md`（結果を記録する）

- [ ] **Step 1: ブランチを push して、プレビューのビルドを待つ**

Run: `git push -u origin feature/chakuga-webcam-photo`
Expected: Vercel のプレビューが Ready。プレビューは本番の DB につながるので、確定したコーデは本番に入る（実際に着たものだけ確定する）。

- [ ] **Step 2: ユーザーがプレビューで確かめる**（Mac の Chrome。内蔵カメラのあと、Logicool のカメラで）

1. 許可を出すとカメラが映り、自分の右手が画面の右に映る（鏡と同じ）。
2. 文字を書いた紙を持って撮ると、確認画面と保存された写真の文字が正しい向きで読める。
3. 「5秒後に撮る」で 5→1 の表示と音が出て、0 で撮れる。「やめる」で止まる。
4. カメラを切り替えられる。再読み込みのあと、もう一度「カメラで撮る」を押すと、最後に使ったカメラが開く。
5. Logicool のカメラを横に倒し、「向きを回す」で映像がまっすぐになる（90° と 270° の両方）。映像は伸び縮みせず、映っている範囲と保存された写真の範囲が同じ。写真は縦長で、幅と高さが回転の前と入れ替わる（1280×720 で取れていれば 720×1280。実際の大きさは確認画面の数字で見る）。拡大されていない。文字は反転していない。
6. 「撮り直す」で映像に戻る。「この写真を使う」で送られ、服を選んで確定まで進む（コーデの画面に写真が出る）。Offline で「この写真を使う」→「もう一度送る」でも完了する。
7. カメラを拒否すると理由が出て、写真を選ぶ欄で記録できる。ほかのアプリがカメラを使っているときも理由が出る。
8. 撮影中に USB を抜くと、撮られずに理由が出る。
9. 映っている間に別の画面へ移ると、カメラのライトが消える。戻っても勝手に点かない。
10. 確認中に別の画面へ移って戻ると、写真が残っている。
11. カウントダウン中にファイルを選ぶと、撮影は止まり、選んだ写真が使われる。
12. 確認中の写真があるままファイルを選んで確定し、記録画面へ戻ると、確認中の写真は残っていない。
13. 確認中の写真があるまま、下書きを確定する途中で別の画面へ移り（DevTools の Slow 4G で確定を遅くする）、確定のあとで記録画面へ戻ると、確認中の写真は残っていない。
14. カメラの許可を聞かれている間に「閉じる」を押し、そのあと許可しても、映像は出ず、撮影も始まらず、ライトは点いたままにならない（一瞬だけ点くことはある。止められない `getUserMedia` が映像を返すとすぐ止めるため）。
15. 既存の流れ：写真を選んで送り、確定できる。

- [ ] **Step 3: 720p の画質を確かめる（ユーザーの判断）**

撮った写真で、服の見分けがつくかを見る。AI の精度も見るときは、`scripts/smoke-cloudflare.mts` に撮った写真を渡す（Cloudflare への書き込みなので承認が要る）。足りなければ新しいカメラを検討する（2026-10-27 ユーザー決定）。

- [ ] **Step 4: 通しの差分を Codex がレビューする**

- [ ] **Step 5: PR を作り、ユーザーの承認のあとマージする**

本番の環境変数、DB、webhook は変えない。マージで本番がデプロイされたら、本番で Step 2 の 2・3・6・15 を確かめ、`docs/project/TODO.md` に記録してコミットする。

遅れたときに削る順：カウントダウンの音 → 最後に使ったカメラを覚える → カメラの機能を丸ごと 11/5 へ。

---

## 仕様との対応（このプランで扱わないもの）

| 仕様の項目 | 担当 |
|---|---|
| 約5秒の動画の録画、動画から静止画を選ぶ、動画と写真の両方の保存、録画できないときに写真だけ | Plan 2 |
| 着画のアップロード上限（Ruling 13） | Plan 2 |
| 「＋記録」ボタン、Today のカード | Plan 3 |
| 撮影待機の全画面モード、外部のシャッター（`CaptureTrigger` を差し替える） | 11/10 以降 |
| 使われなかった下書きの片付け（既存の課題。写真を選び直したときに残る） | Plan 3 |
