# Phase 3-5 開発ログ: コート較正 / ボール追跡 / 自動採点

**日付**: 2026-05-17  
**担当**: Claude Code (ロジック・テスト) + Codex (UI)  
**対象バージョン**: CourtLens v1.x (Expo SDK 54)

---

## 概要

Phase 2（姿勢推定によるフォーム分析）で導入した CV ランタイム（`react-native-fast-tflite` / `expo-video-thumbnails` / `jpeg-js`）を再利用し、**追加ネイティブ依存ゼロ**で以下を完全オンデバイス実装:

- **Phase 3**: コート較正（DLT ホモグラフィ + 4 隅タップ UI）
- **Phase 4**: 古典的ボール追跡（フレーム差分 → ブロブ検出 → 貪欲トラッキング → バウンド検出）
- **Phase 5**: 決定論的自動採点ステートマシン（確認 UI 必須ガード）

---

## Phase 3: コート較正

### 目的

ボール座標を「画像ピクセル」から「コート正規化座標 (0–1)」へ変換するためのホモグラフィ行列を算出し、セッションに永続化する。

### ロジック

**DLT (Direct Linear Transform) ホモグラフィ算出** — `src/utils/homography.ts`

4 点対応から 3×3 ホモグラフィ行列を純 JS で算出。アルゴリズム:

1. 各点対応から 2 行の線形方程式を生成（8×8 齐次方程式系）
2. Gauss-Jordan で解き、ノルム正規化して 3×3 行列を得る
3. `applyHomography(matrix, point)` で画像→コート / コート→画像を変換
4. 逆行列（`invertMatrix3x3`）で双方向変換を提供

コート 4 隅の固定座標: `[(0,1), (1,1), (1,0), (0,0)]`（手前左→手前右→奥右→奥左の順）

**コート幾何ユーティリティ** — `src/utils/court-geometry.ts`

- `projectImageToCourt(imagePoint, calibration)`: 画像正規化座標 → コート座標
- `projectCourtToImage(courtPoint, calibration)`: コート座標 → 画像正規化座標
- `isInCourtBounds(courtPoint, margin?)`: コート内外判定（デフォルト margin=0）

**静止フレーム抽出** — `src/services/pose/frameSampler.ts`（拡張）

`extractStillFrame(uri, timeSec)`: `expo-video-thumbnails` で動画中間フレームを JPEG 抽出し、`Image.getSize` でピクセル寸法を付与。Phase 2 のフレームサンプラーを拡張して共有。

**較正ロジック** — `src/services/court/calibrate.ts`

`buildCalibration(imageCorners, referenceTimeSec, thumbnailUri?)`: 4 隅座標から DLT を実行して `CourtCalibration` 型を返す。

**較正バリデーション** — `src/services/court/validate.ts`

`validateCalibration(calibration)`:

- 4 点が一直線上でないこと（外積の符号チェック）
- 凸四角形であること（時計回りの cross-product が全正）
- NG の場合は日本語エラー文字列を返す

### UI (Codex)

- `app/session/[id]/calibration.tsx`: 動画中間フレームをサムネイルとして表示、SVG オーバーレイに 4 つのドラッグ可能ハンドルを重ねる
- `src/components/court/CalibrationCanvas.tsx`: `PanResponder` で正規化座標を更新、`react-native-svg` でコート輪郭線・ハンドル・ラベルを描画
- ラベル: 手前左 / 手前右 / 奥右 / 奥左

### 型定義

```ts
// src/types/court.ts
export interface ImagePoint {
  x: number;
  y: number;
} // 正規化 0..1
export interface CourtPoint {
  x: number;
  y: number;
} // 正規化 0..1
export interface CourtCalibration {
  imageCorners: [ImagePoint, ImagePoint, ImagePoint, ImagePoint];
  homography: number[]; // 9要素 row-major
  referenceTimeSec: number;
  referenceThumbnailUri?: string;
  createdAt: string;
}
```

### ストア拡張

`sessionStore.setCourtCalibration(sessionId, calibration)` を追加。persist key `courtlens-sessions` 維持（optional フィールドのため後方互換）。

---

## Phase 4: ボール追跡（古典的 CV）

### パイプライン概要

```
動画クリップ (videoUri + [startSec, endSec])
    │
    ▼
sampleFrames (@ 15fps)
    │
    ▼
decodeFrameGray  →  グレースケール Uint8Array (320px幅に縮小)
    │
    ▼
computeMotionMask (3フレーム差分 AND)
    │
    ▼
detectBlobs  →  連結成分ラベリング → 候補フィルタリング
    │
    ▼
trackBall  →  貪欲マッチング → BallTrajectory
    │
    ▼
detectBounces  →  imageY 局所最大 → Bounce[]
    │
    ▼
analyzeRally()  (Progress 0→1)
```

### 各コンポーネント詳細

**フレームデコード** — `src/services/ball/decodeFrame.ts`

- TARGET_WIDTH = 320px（I/O 抑制のため縮小）
- `expo-file-system` 新 File API でバイト読み込み → `jpeg-js` でデコード
- RGBA → グレースケール変換: `0.299R + 0.587G + 0.114B`

**フレーム差分** — `src/services/ball/frameDiff.ts`

- DIFF_THRESHOLD = 25
- 連続 3 フレーム（t-1, t, t+1）間の絶対差分の AND を取る
- 静止背景・単発ノイズを同時に抑制（古典的テニスボール検出の標準手法）

**ブロブ検出** — `src/services/ball/blobDetect.ts`

- Two-pass 連結成分ラベリング（Union-Find + 8 近傍）
- フィルタ条件:
  - 面積: 3–80 px²
  - 縦横比: 0.4–2.5
  - 円形度: 4πA/P² ≥ 0.35

**トラッカー** — `src/services/ball/tracker.ts`

- 貪欲最近傍マッチング
- MAX_JUMP = 0.08（正規化距離）
- MIN_TRACK_LENGTH = 5 フレーム（短い追跡を破棄）
- 追跡断絶時は新トラックを開始、最長のものを採用

**バウンド検出** — `src/services/ball/bounceDetect.ts`

- SMOOTH_WINDOW = 3（移動平均）
- `imageY` の局所最大（画像座標は下向き正）で一次検出
- `projectImageToCourt` でコート座標に変換してバウンド位置を確定
- `isInCourtBounds` で `inBounds` フラグを付与

**統合エントリポイント** — `src/services/ball/index.ts`

`analyzeRally(opts)`: progress コールバック対応（0→1）

### 型定義

```ts
// src/types/ball.ts
export interface BallDetection {
  timeSec: number;
  imageX: number; // 正規化 0..1 (320px 基準)
  imageY: number;
  radiusPx: number;
  confidence: number;
}
export interface BallTrajectory {
  detections: BallDetection[];
}
export interface Bounce {
  timeSec: number;
  imagePoint: ImagePoint;
  courtPoint: CourtPoint;
  inBounds: boolean;
}
```

### 検出精度について

撮影条件（コート色・ボール色・光量・カメラ揺れ）に強く依存する。三脚固定・真横アングル・十分な解像度が必須。

---

## Phase 5: 自動採点（決定論的ステートマシン）

### ルールエンジン — `src/services/scoring/rules.ts`

入力: `Bounce[]` + `endTimeSec` + `{ playerSide, isServe, serveAttempt? }`

判定ロジック（純関数）:

```
courtY > 0.5 → near (プレイヤー側)
courtY ≤ 0.5 → far  (相手側)

アウト判定:
  far 側でアウト → プレイヤーが打ちすぎ → lost
  near 側でアウト → 相手がアウト     → won

連続バウンド判定:
  同サイドに連続 2 バウンド目 → そのサイドのプレイヤーが取れなかった
  near に 2 バウンド → lost
  far に 2 バウンド  → won

サーブ:
  1st でアウト → null（ファースト失敗、ポイントにならない）
  2nd でアウト → ダブルフォルト → lost
  ネット越えは courtY=0.5 通過で簡易判定
```

### 候補生成 — `src/services/scoring/autoScore.ts`

`proposeCandidates(rallyAnalysis, options)` → `AutoPointCandidate[]`

各候補に `diagnostics: string[]`（判定根拠テキスト）を付与。1 ラリー = 1 候補。

### 確認 UI（必須ガード）

- `AutoPointCandidate` は揮発性（store に永続化しない）
- ユーザーが明示的に「採用して保存」を押した場合のみ `addPoint` を呼ぶ
- 棄却・編集前の候補は何も保存しない

### 型定義

```ts
// src/types/scoring.ts
export interface AutoPointCandidate {
  id: string;
  suggestedOutcome: PointOutcome;
  suggestedShotType: ShotType;
  suggestedResultReason: ResultReason;
  suggestedRallyCount: number;
  suggestedShotLocation?: ShotLocation;
  suggestedServeResult?: ServeResult;
  videoTimestamp: number;
  diagnostics: string[];
}
```

---

## 主要ファイル一覧

| ファイル                                     | 役割                                       |
| -------------------------------------------- | ------------------------------------------ |
| `src/utils/homography.ts`                    | DLT ホモグラフィ算出（Gauss-Jordan）       |
| `src/utils/court-geometry.ts`                | 座標変換・境界判定                         |
| `src/types/court.ts`                         | ImagePoint / CourtPoint / CourtCalibration |
| `src/types/ball.ts`                          | BallDetection / BallTrajectory / Bounce    |
| `src/types/scoring.ts`                       | AutoPointCandidate                         |
| `src/services/court/calibrate.ts`            | buildCalibration                           |
| `src/services/court/validate.ts`             | validateCalibration                        |
| `src/services/ball/decodeFrame.ts`           | JPEG→グレースケール                        |
| `src/services/ball/frameDiff.ts`             | 3フレーム差分マスク                        |
| `src/services/ball/blobDetect.ts`            | 連結成分ラベリング                         |
| `src/services/ball/tracker.ts`               | 貪欲トラッカー                             |
| `src/services/ball/bounceDetect.ts`          | バウンドイベント検出                       |
| `src/services/ball/index.ts`                 | analyzeRally() エントリポイント            |
| `src/services/scoring/rules.ts`              | テニスルール SM                            |
| `src/services/scoring/autoScore.ts`          | proposeCandidates()                        |
| `src/stores/sessionStore.ts`                 | setCourtCalibration 追加                   |
| `app/session/[id]/calibration.tsx`           | コート較正画面                             |
| `app/session/[id]/ball-trace.tsx`            | ボール軌跡診断画面                         |
| `app/session/[id]/auto-score.tsx`            | 自動採点確認画面                           |
| `src/components/court/CalibrationCanvas.tsx` | 4隅ドラッグ UI                             |
| `src/components/court/BallTraceOverlay.tsx`  | 軌跡・バウンドオーバーレイ                 |
| `src/components/scoring/AutoPointCard.tsx`   | 候補カード                                 |
| `src/components/common/SecondSlider.tsx`     | 秒数スライダー                             |

---

## テスト

| テストファイル                               | カバー範囲                                       |
| -------------------------------------------- | ------------------------------------------------ |
| `__tests__/utils/homography.test.ts`         | 単位変換・台形ラウンドトリップ・縮退ケース       |
| `__tests__/services/ball/blobDetect.test.ts` | 単一ブロブ・空・サイズフィルタ・複数ブロブ       |
| `__tests__/services/scoring/rules.test.ts`   | won/lost 各パターン・ダブルフォルト・1stフォルト |

---

## 既知の制約

1. **ボール検出率**: 撮影条件依存。三脚固定・コート全体可視・十分な光量が必須。
2. **ラリー区間は手動**: ball-trace / auto-score 画面でユーザーがスライダーで指定。
3. **ホモグラフィは平面前提**: テニスコートはほぼ平面なので実用上は妥当。
4. **expo-video-thumbnails は SDK56 で廃止予定**: SDK56 アップグレード時に `expo-video` の seek/thumbnail API へ移行予定。
5. **自動採点は補助**: 決定論的判定のため誤検出あり。必ずユーザー確認が必要。
