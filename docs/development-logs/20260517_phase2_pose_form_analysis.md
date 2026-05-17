# Phase 2 — オンデバイス姿勢推定によるフォーム分析（開発ログ）

**実施日**: 2026-05-17  
**対象ブランチ**: master

---

## 目的

動画クリップから選手の姿勢をオンデバイス推定し、ショット別のフォームスコアと改善コメントを生成する。クラウドバックエンドなし・完全ローカル処理。

---

## 全体アーキテクチャ

```
クリップ取得
  ├─ 専用「フォーム撮影」（camera → VideoRecorder）
  └─ 既存セッション動画 + 時間ウィンドウ指定
       ↓ videoUri + [startSec, endSec] + shotType
動画永続化 (expo-file-system: File/Directory/Paths API → documentDirectory/videos/<id>.mp4)
       ↓
フレーム抽出 (expo-video-thumbnails: 等間隔 20 枚 JPEG, quality 0.7)
       ↓
JPEG → テンソル (jpeg-js decode → 中心クロップ → 192×192 リサイズ → Float32Array [0,1])
       ↓
姿勢推論 (react-native-fast-tflite + MoveNet Lightning → 17 キーポイント [y,x,score] × フレーム)
       ↓
スイング指標算出 (PoseFormAnalyzer: ショット別 heuristic → SwingMetric[] + overallScore 0-100)
       ↓
FormAnalysisResult → formAnalysisStore に永続化 → 結果画面
```

---

## 採用技術と選定理由

| 技術 | 採用理由 |
|---|---|
| `react-native-fast-tflite` | Nitro JSI ベース・JS スレッド単体推論可（worklets-core 不要）・CoreML デリゲート対応 |
| MoveNet Lightning (float16) | 4.5MB・192×192 入力・モバイル高速・17 COCO キーポイント・MVP に十分な精度 |
| `expo-video-thumbnails` | JPEG file URI を返すため jpeg-js で直接デコード可（expo-video の `nativeRefType` は不可） |
| `jpeg-js` | 純 JS・Hermes で Buffer polyfill なし動作・`Uint8Array` 直接受付 |
| expo-file-system 新 API | `File/Directory/Paths` クラスで `file.bytes()` → `Uint8Array` 取得（旧 API は SDK54 で実行時エラー） |

---

## 主要ファイル

### 型定義・ストア

| ファイル | 内容 |
|---|---|
| `src/types/pose.ts` | `Keypoint`, `PoseFrame`, `SwingMetric`, `FormAnalysisResult`, `FormAnalysis` |
| `src/stores/formAnalysisStore.ts` | Zustand + persist (key: `courtlens-form-analyses`)。`poseFrames` は保存しない |

### サービス

| ファイル | 内容 |
|---|---|
| `src/services/video/videoStore.ts` | `persistVideo(uri): Promise<string>` — 揮発 URI を `documentDirectory/videos/` にコピー |
| `src/services/pose/frameSampler.ts` | `sampleFrames(uri, startSec, endSec, count=20)` — expo-video-thumbnails で JPEG 抽出 |
| `src/services/pose/imageToTensor.ts` | `jpegUriToTensor(uri): Promise<ArrayBuffer>` — File.bytes() → jpeg-js → 192×192 Float32Array |
| `src/services/pose/poseModel.ts` | `getPoseModel()` (singleton) + `inferFrames(frames, onProgress?)` |
| `src/services/pose/index.ts` | `analyzeClip(opts): Promise<FormAnalysis>` — 上記を統合。プログレスコールバック対応 |
| `src/services/analysis/PoseFormAnalyzer.ts` | `analyzeForm(frames, shotType): FormAnalysisResult` — heuristic 指標算出 |

### UI（Codex 実装）

| ファイル | 内容 |
|---|---|
| `app/form-analysis/new.tsx` | 入口：ソース選択 + ショット種別セグメント |
| `app/form-analysis/capture.tsx` | 専用撮影フロー（VideoRecorder → analyzeClip） |
| `app/form-analysis/select.tsx` | 既存セッション動画選択 + 時間ウィンドウ |
| `app/form-analysis/[id].tsx` | 結果画面：スコアリング + 指標カード |
| `src/components/pose/FormScoreRing.tsx` | SVG アーク（react-native-svg）によるスコア可視化 |
| `src/components/pose/SwingMetricCard.tsx` | good/fair/poor を色分けしたメトリクスカード |
| `src/components/pose/PoseOverlay.tsx` | SVG 骨格オーバーレイ（COCO 接続、score > 0.3 フィルタ） |
| `src/components/pose/FormAnalysisEntryCard.tsx` | ホーム・レポートからの入口カード |

---

## 修正した技術的問題

### expo-file-system の旧 API が実行時エラー

- **問題**: `FileSystem.documentDirectory`, `readAsStringAsync`, `copyAsync` が SDK54 で `throws in runtime`。
- **修正**: `File`, `Directory`, `Paths` クラスベースの新 API に全面切替。`file.bytes()` で `Uint8Array` 直接取得。

### react-native-fast-tflite の型制約

- `loadTensorflowModel` は引数 2 つ必須（source + delegates 配列）。
- `runSync` の入力は `ArrayBuffer[]`（`Float32Array[]` 不可）。`tensor.buffer as ArrayBuffer` でキャスト。
- 出力も `ArrayBuffer[]` — `new Float32Array(outputBuffer)` でパース。

### jpeg-js と Hermes の互換

- `jpeg.decode(uint8Array, { useTArray: true })` で `Buffer` polyfill なし動作。

---

## スイング指標（PoseFormAnalyzer）

**共通指標**（全ショット）:
- `膝の曲げ角度`: 腰-膝-足首の角度。良好範囲 100-150°。
- `フォロースルー量`: インパクト後の手首移動量（正規化座標）。

**ショット別指標**:
- サーブ/スマッシュ: 打点の高さ（手首-鼻の相対位置）、膝の伸び上がり、トス腕の伸展。
- フォア/バック/ロブ/ドロップ: 体の前での打点（手首-腰の分離距離）、捻転角（X-factor）。
- ボレー: スイングのコンパクトさ（手首最大速度）、前での打点（手首-肩の分離）。

**採点**: 各指標 good=100/fair=60/poor=20 で平均 → 総合スコア 0-100。

---

## ネイティブ統合

- `metro.config.js` 新設: `.tflite` を `assetExts` に追加。
- `app.json` plugins: `"expo-file-system"` + `["react-native-fast-tflite", {"enableCoreMLDelegate": true}]`。
- `assets/models/movenet-lightning.tflite`: 4.5 MB (TF Hub から取得)。

---

## 既知の制約・注意事項

- 姿勢推定精度は「参考値」。コート全体を撮影したセッション動画は選手が小さく精度が落ちるため、専用撮影（近接）を推奨導線とする。
- `expo-video-thumbnails` は SDK56 で削除予定。SDK56 アップグレード時に `expo-video` のサムネイル API へ移行が必要。
- 20 フレームのバッチ処理で数秒〜十数秒かかる（実機・CoreML で高速化）。

---

## 次フェーズ

Phase 3-5: コート較正・ボール追跡・自動採点（`20260517_phase3_5_court_cv.md` 参照予定）。
