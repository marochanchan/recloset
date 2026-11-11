# MediaPipe（背景の処理）

動画から選んだコマの背景を、ブラウザの中で「ぼかす／白」にするためのファイル。写真は外に出さない。

- `wasm/` : `@mediapipe/tasks-vision` 1.2.2 に入っている wasm とその読み込み用の JS（Apache License 2.0、Google）。
- `models/selfie_multiclass_256x256.tflite` : MediaPipe の Image Segmenter 用モデル「Selfie Segmentation（multiclass）」（約 16MB、Apache License 2.0、Google）。
  - 取得元：https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite
  - ライセンスの根拠（モデルカード）：https://storage.googleapis.com/mediapipe-assets/Model%20Card%20Multiclass%20Segmentation.pdf
  - クラス：0 背景、1 髪、2 体の肌、3 顔の肌、4 服、5 その他。
  - 解説：https://ai.google.dev/edge/mediapipe/solutions/vision/image_segmenter

## ライセンス

上のファイルはすべて Apache License 2.0 で配布されている。本文は同じフォルダの [`LICENSE`](./LICENSE)（Apache 公式の本文：https://www.apache.org/licenses/LICENSE-2.0.txt）。
`@mediapipe/tasks-vision` 1.2.2 のパッケージに LICENSE／NOTICE のファイルは含まれていない（package.json の license が Apache-2.0）。
JS のファイルの先頭にある著作権・ライセンスの表示は、そのまま残している。
