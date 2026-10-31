# 課題トピックと技術キーワード

- 作成：2026-10-31
- 🤖 AI生成（Claude Code）
- 印：無印は Repo の文書やコードにある語。【追加】は Repo になく、解説に要りそうなので足した語

## 1. 構成の変更：スマホがハブ、鏡は撮影専用（第1話）

**課題**

- 鏡→スマホ→クラウドの一本の道にする得失
- 「頭脳はスマホ」と言えるのはどこまでか。AI の計算はサーバー側の Gemini
- 仕様書の将来像（ローカル GPU の AI パソコン）と変更案のずれ

**キーワード：** ハブ型の構成、経路 A（平置き）、経路 B（着画）、Phase 0〜5、MVP

## 2. プラン A とプラン B（第1話、第2話）

**課題**

- A は Web アプリのまま手で転送。B は iPhone アプリで受け取る。発表で何が変わるか
- 関門 0 → 関門 1 → 11/4 に marochanchan が決定。11/8 の夜に動かなければ A に戻る
- B で無駄になる作業はどれか

**キーワード：** 関門、切り戻し、Plan 2a、撮影スクリプト、手で送る PoC、録画デモ

## 3. ネイティブアプリの基礎（第2話）

**課題**

- Capacitor、Expo／React Native、PWA の違い。今のコード（26画面、Server Actions、Cookie のログイン）で Capacitor を選ぶ理由
- `server.url` は本番向けではない
- 審査の Guideline 4.2。実機か TestFlight で見せる
- Intel Mac の Xcode 26.x で iOS 27 の iPhone に入れられるか（未確認で、最大の不安）
- Xcode 27 は Intel Mac で使えない見込み。macOS の版と空き容量 40〜60GB

**キーワード：** Capacitor 8、Expo、React Native、PWA、静的書き出し、Server Actions、Xcode、Apple Developer Program、TestFlight、クラウドビルド

**【追加】：** WebView、ネイティブブリッジ、コード署名、Info.plist と権限の宣言

## 4. 鏡とスマホの通信（第4話）

**課題**

- 連携は、スマホの QR コードを鏡のカメラにかざす案（Matthew の案）。前例は Wyze など
- コードに入れるものと有効期限。読めたことを音や光で知らせる
- HTTPS の画面から `http://192.168.x.x` を読むと mixed content で止められる可能性
- iOS のローカルネットワークの権限と、鏡の探し方
- 会場の Wi-Fi では端末どうしが通信できない可能性
- iPhone に USB の Webカメラはつなげない見込み

**キーワード：** 同一 LAN、Pull 方式、小さな HTTP サーバー、Bluetooth LE、Wi-Fi Direct、mixed content、ペアリング、QR コード

**【追加】：** App Transport Security、NSLocalNetworkUsageDescription、NSBonjourServices、mDNS／Bonjour、CapacitorHttp、AP アイソレーション、LAN 内の HTTPS

## 5. Raspberry Pi と鏡のハードウェア（第3話）

**課題**

- GPU なしの Raspberry Pi 5 で目安2万円（Issue #8、提案の段階）
- 2万円は部品代か販売価格か。鏡の代金を含めるか
- Pi 5 は 4GB で2万円を超える（10/31 の国内の表示）。5 の 1GB か Zero 2 W か
- Mac から移すときに変わるもの。常時稼働の信頼性、未転送の写真の保管
- GPU パソコン案を将来の選択肢に回すことで、文書の製品像をそろえる

**キーワード：** ハーフミラー、SSD、ローカル GPU、SwitchBot

**【追加】：** Pi 5／Zero 2 W、CSI カメラと USB（UVC）カメラ、Camera Module 3、視野角、libcamera、systemd、SD カードの摩耗、技適、PSE、OTA 更新、AI アクセラレーター

## 6. カメラと撮影（第3話）

**課題**

- 3つのカメラの整理：Plan 2a（Mac のブラウザで撮る、マージ済み）、撮影スクリプト（鏡の代わり）、平置きのアプリ内カメラ
- ブラウザのカメラ制御の落とし穴：開く途中で閉じる、USB が抜ける、ライトが点いたまま
- 左右反転の扱い
- 全身が入る距離と高さ、5秒で立ち位置に間に合うか。Logicool BRIO 100 は 1920×1080、回すと縦長
- ハンズフリーの合図（人の検知、音声、手のひら）が GPU なしで動くか

**キーワード：** getUserMedia、canvas、Web Audio、`CameraSource`、`CaptureController`、ダミーのカメラ、縦長の回転、EXIF、長辺2560px・JPEG 品質0.9、トリミング、明るさの調整、動画から静止画

**【追加】：** MediaPipe、ウェイクワード、AVFoundation

## 7. 同期処理（第5話）

**課題**

- 3つの区間：鏡→スマホ、スマホ→クラウド、将来の複数端末
- 今ある土台：直接アップロード、送り直しで二重にしない、実体を確かめる、古い結果で上書きしない
- 端末にためると増える問題：アプリの終了、順序、ログインの変化
- iOS のバックグラウンド制限。Background Runner は1回約30秒で向かない
- 構想（元の写真の保存は任意）とプラン B（初期は全部クラウド）のずれ

**キーワード：** 非同期アップロード、同期キュー、再送、サムネイル優先の同期、受信確認、Direct Creator Upload、メディア ID、試行回数、Webhook と HMAC 署名、Cron の削除待ち、`after()`

**【追加】：** 冪等性、結果整合性、楽観ロック、CRDT、Background URLSession、端末内の SQLite

## 8. 服の類似判定（第6話）

**課題**

- 見え方の違い、似た服、隠れた服
- 6つの候補の比較と、推薦（タグで絞る → AI が見比べる → 人が確定する。PR #9）
- 費用は着画1枚で約1〜2円の試算。精度は未確認で、11/3 の写真で試験する
- 全身写真を外部 AI に送ること

**キーワード：** 物体検出、領域分割、Embedding、類似度、ベクトル検索、OpenCV、メタデータ、見分ける→順位付け→見比べる、1位の正解率、Gemini、Vercel AI Gateway、構造化出力、ローカル AI

**【追加】：** pgvector、CLIP／FashionSigLIP、SAM、コサイン類似度、Human-in-the-loop

## 9. データモデル（第6話）

**課題**

- 「グラフ」を PostgreSQL のテーブルでどう表すか。Neo4j や GraphRAG は今は要らない
- 変更案のノードと今のテーブルの対応（仕様書への追記が残り）

**キーワード：** ノードとエッジ、`outfits`、`outfit_media`、`outfit_items`、`item_pair_monthly_stats`、RPC、RLS、列ごとの権限

## 10. 画像の配信とコスト（第7話）

**課題**

- Supabase の Egress：10/27 時点の試算で 11/10 ごろに 5GB を超える。11/1 に確認し Pro にするか決める
- 署名付き URL が変わるとキャッシュが効かない問題（仮説）
- Cloudflare は配信を自動で止められない
- 圧縮の検討（Issue #6 の Matthew のコメント）：Cloudflare Images の料金は枚数なので減らない。効くのは送信時間、端末の容量、Supabase の平置き

**キーワード：** Egress、Pro プラン、`next/image`、Cloudflare Images、バリアント、`requireSignedURLs`、Cloudflare Stream、Starter Bundle、Budget Alerts、R2

**【追加】：** JPEG XL、AVIF、WebP、HEIC、CDN とキャッシュキー

## 11. プライバシーと安全（第4話）

**課題**

- クローゼットの鏡に常設するカメラとマイク
- 鏡の HTTP サーバーの写真を LAN の中の誰が取れるか。QR コードの鍵で守る
- 写真はクラウドと AI に渡る。全部が手元で閉じるように聞こえる説明は避ける

**キーワード：** `requireSignedURLs`、署名の鍵の管理

**【追加】：** LAN 内の認証、ペアリングの鍵、オンデバイス処理、同意と保持期間

## 主な日付

- 11/1：Egress を確認
- 11/3：撮影、PoC、服を当てる試験。類似判定を発表に入れるか決める
- 11/4：プラン B に切り替えるか決める
- 11/8 の夜：プラン B の打ち切りの判断
- 11/16：GGA の発表
