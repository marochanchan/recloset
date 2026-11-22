# Supabase 認証メールのテンプレート（日本語版の控え）

2026-11-03 に Supabase の管理画面（Authentication → Emails）で日本語にしたもの。
2026-11-22 に Supabase を Free プランに戻すと、英語の初期状態に戻り、独自の SMTP を設定するまで編集できなくなる。そのため、ここに控えておく。

**戻し方（一般公開の前に）**
1. Supabase → Project Settings → Authentication → SMTP Settings で、独自の SMTP（例：Resend の無料枠）を設定する。
2. Authentication → Emails で、下の件名と本文を貼り直す。

---

## Confirm signup（メールアドレスの確認）

件名：

```
Re:Closet｜メールアドレスの確認
```

本文：

```html
<div style="font-family: Arial, sans-serif;
            color: #333333;
            line-height: 1.8;
            max-width: 560px;
            margin: 0 auto;
            padding: 24px;">

  <h2 style="margin-bottom: 24px;">
    Re:Closetへようこそ！
  </h2>

  <p style="margin-bottom: 24px;">
    このたびはRe:Closetにご登録いただき、<br>
    ありがとうございます。
  </p>

  <p style="margin-bottom: 32px;">
    登録を完了するために、以下のボタンから<br>
    メールアドレスの確認をお願いします。
  </p>

  <p style="margin-bottom: 32px;">
    <a href="{{ .ConfirmationURL }}"
       style="display: inline-block;
              background-color: #6F8068;
              color: #ffffff;
              padding: 12px 24px;
              border-radius: 8px;
              text-decoration: none;
              font-weight: bold;">
      メールアドレスを確認する
    </a>
  </p>

  <p style="font-size: 13px;
            color: #777777;
            margin-bottom: 24px;">
    このメールにお心当たりがない場合は、<br>
    そのまま破棄してください。
  </p>

  <p style="margin-top: 32px;">
    Re:Closet
  </p>

</div>
```

---

## Reset password（パスワード再設定）

件名：

```
Re:Closet｜パスワード再設定のご案内
```

本文：

```html
<div style="font-family: Arial, sans-serif;
            color: #333333;
            line-height: 1.8;
            max-width: 560px;
            margin: 0 auto;
            padding: 24px;">

  <h2 style="margin-bottom: 24px;">
    パスワード再設定のご案内
  </h2>

  <p style="margin-bottom: 24px;">
    Re:Closetをご利用いただき、<br>
    ありがとうございます。
  </p>

  <p style="margin-bottom: 32px;">
    パスワードの再設定リクエストを受け付けました。<br>
    以下のボタンから、新しいパスワードを設定してください。
  </p>

  <p style="margin-bottom: 32px;">
    <a href="{{ .ConfirmationURL }}"
       style="display: inline-block;
              background-color: #6F8068;
              color: #ffffff;
              padding: 12px 24px;
              border-radius: 8px;
              text-decoration: none;
              font-weight: bold;">
      パスワードを再設定する
    </a>
  </p>

  <p style="font-size: 13px;
            color: #777777;
            margin-bottom: 24px;">
    このメールにお心当たりがない場合は、<br>
    リンクを開かず、そのまま破棄してください。
  </p>

  <p style="margin-top: 32px;">
    Re:Closet
  </p>

</div>
```
