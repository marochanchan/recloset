# Re:Closet の iPhone アプリ（プラン B の殻）

Capacitor 8 の殻で、本番（`https://recloset-sable.vercel.app`）をそのまま読み込みます。`server.url` を使う**発表用の構成**で、公開用ではありません。計画は `docs/feedback1031/plan-b-native-app.md` にあります。

## 中身

- `capacitor.config.json`：アプリの ID（`com.marochanchan.recloset`）と読み込む URL
- `www/index.html`：読み込めなかったときの予備の画面（Capacitor が必要とする）
- `ios/`：Xcode のプロジェクト。プラグインは Swift Package Manager で入る（CocoaPods は使わない）

## 準備

```sh
cd mobile
npm ci
CI=1 npx cap sync ios   # 設定を変えたら毎回。CI=1 がないと、Claude Code の中では無言で止まる
```

## 手元の iPhone で起動する（無料の Apple ID）

1. Xcode の **Settings → Apple Accounts** で、Apple ID を追加する
2. `npx cap open ios` で Xcode を開く
3. 左の **App** → **Signing & Capabilities** → **Team** で、自分の名前の **(Personal Team)** を選ぶ
4. iPhone を USB で Mac につなぎ、iPhone で「このコンピュータを信頼」を選ぶ
5. iPhone の **設定 → プライバシーとセキュリティ → デベロッパモード** をオンにする（再起動がいる）
6. Xcode の上の端末の選び先で自分の iPhone を選び、▶︎（Run）を押す
7. 初回は iPhone で開けないと出るので、**設定 → 一般 → VPN とデバイス管理** で自分の Apple ID を信頼し、アプリを開き直す

無料の Apple ID の署名は**7日で切れます**。切れたら手順 6 をもう一度行います。

## 注意

- Team を選ぶと、`ios/App/App.xcodeproj/project.pbxproj` に Team ID が書き込まれます。秘密の値ではありませんが、コミットするかは差分を見て決めます。
- 署名の鍵や証明書は、このリポジトリに置きません。
