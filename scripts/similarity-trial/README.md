# 類似判定の試験（2026-11-03）

着画に写った服を、登録済みの平置きの服と結びつける方式を、実際の写真で比べる一回きりの試験。仕様は `.superpowers/sdd/2026-11-03-similarity-trial/spec.md`。

データは `.superpowers/similarity-trial/`（gitignore 済み。個人の写真なのでコミットしない）。`--data-dir` で変えられる。

## 準備

1. `looks/` に着画（jpg）を置く。
2. 平置きを本番から取る（読むだけ。既にあるファイルは取り直さない）。秘密鍵は不要。各アカウントのパスワードを順に聞かれる（入力は表示されない）：

```
node --env-file=.env.local scripts/similarity-trial/fetch-flats.mts --email a@example.com --email b@example.com
```

3. `truth.json` を作る（形は下）。`items` の id は `flats/items.json` から選ぶ。

```json
{ "looks": { "look1-a.jpg": { "items": ["<item_id>"], "similar": ["<item_id>"], "hidden": ["<item_id>"] } } }
```

`similar` と `hidden` は `items` の部分集合（任意）。

## 実行

```
# 見込みの表示だけ（AI は呼ばない）
node --env-file=.env.local scripts/similarity-trial/run.mts
# 本番の実行
node --env-file=.env.local scripts/similarity-trial/run.mts --yes
# 埋め込みを飛ばす場合は --skip-embedding を足す
# AI を呼ばない動作確認（env も不要）
node scripts/similarity-trial/run.mts --dry-run --data-dir <仮データのフォルダ>
```

結果は `results/<日時>/summary.md` と `results.json`。AI の結果は `cache/` に残るので、再実行しても同じ入力には課金されない。

## テスト

`npm run test:similarity`
