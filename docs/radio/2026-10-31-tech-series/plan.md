# 企画：リクローゼット技術ラジオ（全7話）

- 作成：2026-10-31
- 🤖 AI生成（Claude Code）。台本も音声も AI で作っています。

## テーマ

スマホをハブにする構成変更のあと、ネイティブアプリ、Raspberry Pi、カメラ、同期処理などの課題が一度に出てきました。これを、耳で聞いて順番に理解できる形に整理します。

## 聴き手

- Matthew と marochanchan
- 移動中などに耳で聞く
- Web アプリは分かるが、iOS の開発やハードウェアは詳しくない人を想定する

## 目的

- 近いうちに決めること（プラン B の切り替え、類似判定を発表に入れるか、製品像）の判断材料をそろえる
- 決まったこと、提案、確かめていないことを、聞き分けられるようにする

## 形式

- 情報説明なので記法は A1：`**話者**:（演出）「本文」`
- 話者：松尾悠人（解説、VOICEVOX の玄野武宏 ID 11）、桜井ひなた（質問、VOICEVOX の四国めたん ID 2）
- 尺：各回7〜8分（生成した音声で合計約52分）
- 演出は `direction.md`、作り方は `../how-to-make.md`、課題と用語の一覧は `topics.md`

## 構成

- **第1話 全体像：** 今のアプリ → 構成の変更 → 頭脳はどこにあるのか → プラン A と B → 近いうちに決めること
- **第2話 ネイティブアプリ：** 3つの作り方 → 本番の画面を読み込む → 足す機能 → Apple の開発環境 → 署名、TestFlight、審査 → 2つの関門
- **第3話 ラズベリーパイの鏡：** GPU が要らない理由 → 値段の現実 → 2万円の意味 → カメラの選び方 → 3つのカメラ → ハンズフリー
- **第4話 つなぐ：** QR コードをかざす前例 → コードに入れるもの → 家の中の通信 → 止められるかもしれない場所 → 会場の Wi-Fi → 全身写真を守る
- **第5話 同期処理：** 3つの区間 → 今ある仕組みと冪等性 → スマホにためると増える問題 → バックグラウンドの壁 → 構想と計画のずれ → Egress は減らない
- **第6話 服を当てる：** 難しさ3つ → 6つの候補 → 推薦の流れ → ベクトル検索は要らないのか → 確かめていないこと → データの形
- **第7話 お金：** Egress → 増える原因 → Cloudflare の枠 → 画像を小さくすると何が減るか → 全体の費用 → 日付で見る次の一手

## 話の中で分けたもの

- **決定：** 期限、撮影を実演しないこと、プラン A を進めること、Plan 2a を続けること（PR #7 は 10/31 にマージ済み）
- **提案（Issue、決定者は別）：** プラン B（#6、決定は marochanchan）、鏡の製品像（#8）、類似判定の推薦（#5、PR #9）
- **AI の提案（だれとも合意していない）：** 鏡を売らず今ある姿見に付ける小さな箱にする案、QR コードの中身（Wi-Fi の名前、パスワード、連携の鍵）、鏡との通信だけを `CapacitorHttp` の専用の呼び出しにする案、発表で「部品代の目安」と言う案
- **未確認：** 下の「確かめていないこと」

## 確かめていないこと

- M1 MacBook Air の Xcode 27 で、iOS 27 の iPhone にアプリを入れられるか
- `CapacitorHttp` で mixed content を避けられるか（公式の文書に mixed content の記載はなく、関門 1 で確かめる）
- App Transport Security の例外が要るか
- アプリが Wi-Fi のパスワードを読めないこと（一般的な知識で、公式の文書では確かめていない）
- Raspberry Pi で人の検知、音声、手のひらの認識が動くか
- 広角のカメラで服の見え方が判定に影響するか
- `gemini-3.5-flash-lite` が服の位置を返せるか
- 服の照合の精度

## 自分で計算した数字

- **全身が入る距離：** カメラを縦に置き、上下2メートルを写す場合。距離 ＝ 1メートル ÷ tan（長いほうの視野 ÷ 2）。広角（102度）で約0.81メートル、標準（66度）で約1.54メートル。カメラの高さが体の真ん中という前提で、実物では測っていない
- **部品代：** Pi 5 の 1GB（9,900円）＋広角カメラ（7,920円）＝17,820円。Zero 2 W（3,520円）＋広角カメラ＝11,440円。電源、カード、ケーブル、ケース、鏡は含まない

## 根拠資料

### Repo の中（2026-10-31 時点）

- `docs/feedback1031/ai-wardrobe-mirror-concept.md`、`docs/feedback1031/plan-b-native-app.md`、`docs/project/TODO.md`（ブランチ `docs/feedback1031`）
- `docs/research/2026-10-31-garment-similarity/report.md`（ブランチ `docs/garment-similarity`、PR #9）
- `docs/superpowers/specs/2026-10-24-chakuga-outfit-relations-design.md`、`docs/superpowers/plans/2026-10-31-chakuga-plan2a-webcam-photo.md`
- `lib/image-processing.ts`、`lib/signed-image-url-cache.ts`、`lib/clothing-image-analysis.ts`、`supabase/migrations/020_create_outfit_schema.sql`
- Issue #3、#5、#6、#8、#10、#11（開発環境を M1 MacBook Air に移す）、PR #4、#7、#9
- プラン B の計画の文書にはまだ「Intel Mac」と書かれています。第2話は、新しい Issue #11 に合わせています

### Repo の外（2026-10-31 に確認）

価格と在庫は動きます。買う前に確かめてください。

- Raspberry Pi 5 の価格（スイッチサイエンス。検索結果の掲載情報で、ページにより在庫の表示が異なる）：[1GB](https://www.switch-science.com/products/10908)、[2GB](https://www.switch-science.com/products/9810)、[4GB](https://www.switch-science.com/products/9249)、[8GB](https://www.switch-science.com/products/9250)
- [Zero 2 W](https://www.switch-science.com/products/7600)、[カメラモジュール V3 広角](https://www.switch-science.com/products/8702)、[V3 標準（Pi 5 用ケーブルつき）](https://www.switch-science.com/products/9933)
- 値上げの経緯：[Tom's Hardware](https://www.tomshardware.com/raspberry-pi/component-shortages-drive-raspberry-pi-prices-up-by-up-to-23-percent-escalating-lpddr4-lpddr5-costs-trigger-the-third-price-hike-of-the-year)、[The Register](https://www.theregister.com/2026/02/02/raspberry_pi_ram_shortage_price_hike/)
- カメラの視野とピント：[SparkFun（Camera Module 3 Wide）](https://www.sparkfun.com/raspberry-pi-camera-module-3-wide-angle.html)、[Raspberry Pi 公式](https://raspberrypi.com/products/camera-module-3)
- QR コードをカメラに読ませる例：[Wyze Cam v3 Pro の手順](https://support.wyze.com/hc/en-us/articles/9857331551771-Wyze-Cam-v3-Pro-Setup-Guide)、[Wyze Cam の手順](https://support.wyze.com/hc/en-us/articles/360030110891-Wyze-Cam-Setup-Guide)、[QR コードのエラー](https://support.wyze.com/hc/en-us/articles/4404886773403-QR-code-is-incorrect)
- iOS のローカルネットワーク：[NSLocalNetworkUsageDescription](https://developer.apple.com/documentation/bundleresources/information-property-list/nslocalnetworkusagedescription.md)、[dnssd（Bonjour）](https://developer.apple.com/documentation/dnssd.md)
- Capacitor：[CapacitorHttp](https://capacitorjs.com/docs/apis/http)
- Cloudflare Images：[料金](https://developers.cloudflare.com/images/pricing/)、[形式と上限](https://developers.cloudflare.com/images/get-started/limits/)
- 音声の規約：[VOICEVOX](https://voicevox.hiroshiba.jp/term/)、[四国めたん](https://zunko.jp/con_ongen_kiyaku.html)
- Background URLSession、製品の技適と PSE は一般的な知識で、今回は出典を確かめていません

## 公開の扱い

このブランチは公開 Repo にあります。台本、音声、この企画は誰でも読めて聞けます。秘密の値、個人の連絡先、ほかの案件の話は入れていません。
