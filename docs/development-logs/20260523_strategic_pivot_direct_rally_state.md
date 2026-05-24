# 戦略ピボット: ball-first → 直接 rally-state 時系列モデル

**日付**: 2026-05-23  
**対象データセット**: `fixed-camera-v2` (8 clip)  
**ベースライン**: `iter-v2-expanded-blob1` aggregate event F1 = **0.433**  
**ゴール**: event F1 ≥ 0.85（IoU ≥ 0.5）

---

## 背景・意思決定

`docs/tennis_rally_interval_detection_research.md`（文献調査レポート）の知見に基づき、ボール追跡（ball-first）から **直接 rally-state（play/non-play）時系列モデル** へ戦略をピボットした。

### 採用した戦略

研究文書の推奨: 「**Direct rally-state segmentation**」が最高 ROI（予測 Event F1: 0.78–0.88）。

理由:
- **TrackNet V1 は REJECT 済み**（F1=0.225。固定カメラ・アマチュア映像へのドメインギャップが構造的）。
- blob baseline は F1=0.433 で天井。手作りヒューリスティックでは突破できない。
- **既存のラリー区間ラベルがそのまま訓練データになる**（フレーム単位の play/non-play に変換するだけ）。
- 文献上の強い証拠: E2E-Spot が 1GPU で tennis precise spotting に 96.1 mAP@1-frame を達成; 固定カメラでは背景中央値差分（background-median diff）が特に有効（RacketVision の知見）。

### 棄却した方向

| アプローチ | 棄却理由 |
|---|---|
| TrackNet V1（再挑戦） | Phase B で REJECT 確定。broadcast→fixed-camera ドメインギャップが構造的。 |
| WASB-SBDT / TOTNet | 同ドメインギャップ＋ CUDA 専用 / 3GPU 訓練設計。Deployment コストが高い。 |
| sklearn 手作り特徴（1D sliding-window） | Phase F で試みて不採用。フレーム単位の独立分類でシーケンスモデルでない。 |
| ball-first CNN + 3D conv | 8 clip では過学習する。目標が rally interval のみならば過剰設計。 |

### データ制約の認識

文献では E2E-Spot は 28 試合 / 3345 クリップで学習。現状 8 clip は **データ飢餓状態**。文書は「30–60 clip に達してから go/no-go 判定せよ」と明記。現フェーズでの F1 はデータ飢餓を反映するため、モデルアーキテクチャの評価には限界がある。

---

## 今サイクルで実施した 3 つの Workstream

### Role division

| 領域 | Owner |
|---|---|
| 戦略決定・計画・レビュー・統合・app wiring | Claude |
| Python ML harness（model.py, train.py 等） | **Codex** |

### Workstream A: Phase 1.5 完了（app wiring）

**問題**: `app/session/[id]/auto-score.tsx:138` が `videoDurationSec: 60` を固定値で渡しており、自動ラリー検出が最初の 60 秒しかスキャンしなかった。

**修正**:
- `useVideoPlayer(session?.videoUri, ...)` + `useEvent(player, 'statusChange', ...)` で実動画時間を取得。
- `handleAutoDetectBatch` に `videoDurationSec`（実値）を渡すよう変更。
- duration 読み込み前は「自動ラリー検出」ボタンを disabled。

```tsx
const videoPlayer = useVideoPlayer(session?.videoUri ?? null, (p) => { p.muted = true; });
useEvent(videoPlayer, 'statusChange', { status: videoPlayer.status });
const videoDurationSec = videoPlayer.duration;
```

**検証**: type-check ゼロエラー、lint ゼロエラー。

---

### Workstream B: 直接 rally-state ML harness 構築（Codex）

新規パッケージ `scripts/eval/rally_state/` を Codex が設計・実装。

#### ファイル構成

| ファイル | 役割 |
|---|---|
| `rasterize.py` | ラベル JSON → 密フレームラベル（play=1/non-play=0）at 2–4fps |
| `extract_features.py` | 10次元特徴ベクトル（フレームごと）を `/tmp/` にキャッシュ |
| `model.py` | 小型 TCN（3層 dilated causal, 32ch）または 双方向 GRU（2層, hidden=32） |
| `train.py` | LOCO CV 必須・重み付き BCE・MPS 対応・VideoRunResult JSON 出力 |
| `predict.py` | 保存済み重みから単クリップ推論 |

#### 特徴ベクトル（10 次元）

```
bg_diff_frac_lo      # 背景中央値差分 > 25px の割合（★固定カメラの最重要フィーチャー）
bg_diff_frac_hi      # 背景中央値差分 > 50px の割合
bg_diff_upper_frac   # 上半分の active 割合
bg_diff_lower_frac   # 下半分の active 割合
frame_diff_frac      # 3フレーム差分（app の frameDiff.ts 移植）
frame_diff_upper_frac
frame_diff_lower_frac
pose_dx              # プレイヤー重心の x 変位（v1 クリップは pose TSV あり）
pose_dy              # プレイヤー重心の y 変位
audio_onset          # librosa onset envelope（v1 クリップのみ有効）
```

背景中央値差分（`np.median(frames, axis=0)`）は固定カメラ映像で **非常に強力** と文献が指摘する（RacketVision: 背景モデリングでテニス MDE を 61.4% 削減）。これが TrackNet 系との最大の差別化点。

#### ポスト処理（train.py → VideoRunResult）

```
sigmoid(logits) → hysteresis(lo=0.35, hi=0.55) → pad(start-3s, end+4s)
→ min-duration filter(4s) → gap-merge(3s) → clamp to [0, duration]
→ VideoRunResult JSON
```

#### 訓練コマンド（今後使う）

```bash
python3.11 scripts/eval/rally_state/train.py \
  --dataset fixed-camera-v2 --run-id rally-state-tcn-v1-full \
  --fps 3 --model tcn --epochs 100 --lr 0.001 --overwrite-features

npm run eval:score -- --run-id rally-state-tcn-v1-full \
  --dataset fixed-camera-v2 --baseline-run-id iter-v2-expanded-blob1
```

> **注意**: `train.py` が出力する frame-level F1 は近似値（フレーム単位の precision/recall）。  
> **実ゲートは `npm run eval:score` の event-level F1（IoU≥0.5）**。

#### smoke test 結果（5 エポック）

- 8 クリップ全て処理完了、エラーなし。
- VideoRunResult JSON フォーマット正常（score-stage1.ts が読み込めることを確認）。
- Event F1=0.000 は期待通り（5 エポックでは収束しない。全クリップを 1 大窓と判定した）。

---

### Workstream C: detector-assist ラベル pre-fill ツール

**目的**: 新規クリップのラベリングを高速化（ゼロから作成するより検出結果を修正するほうが速い）。

```bash
# 新規クリップに blob 検出を実行
npm run eval:run1 -- --run-id draft-<clip-id> --dataset fixed-camera-v2

# 検出結果を DRAFT ラベルに変換
npm run eval:prefill -- --run-id draft-<clip-id> --clip-id <clip-id> --dataset fixed-camera-v2
# → eval/datasets/fixed-camera-v2/labels/<clip-id>_DRAFT.json を出力

# 動画を見ながら境界を修正し、_DRAFT を取り除いてリネーム
# 検証
python3.11 scripts/eval/validate-rally-labels.py --dataset fixed-camera-v2
```

**eval/datasets/fixed-camera-v2/README.md の expansion protocol も更新**:
- `_DRAFT` サフィックスは未検証ラベルを示す（コミット不可）。
- Detector-assist は **training clip のみ**。Held-out test clip は blind ラベルで評価バイアスを防ぐ。

---

## 次のアクション

### 即時: 100 エポック訓練の実行

```bash
python3.11 scripts/eval/rally_state/train.py \
  --dataset fixed-camera-v2 --run-id rally-state-tcn-v1-full \
  --fps 3 --model tcn --epochs 100 --overwrite-features
```

→ `npm run eval:score` で event F1 を確認。

### データ拡張（並行）: 8 → 25–30 clip

candidates.json の `status: "needs_manual_labeling"` クリップを優先。  
`npm run eval:run1` + `npm run eval:prefill` で pre-fill → 手動修正 → validate。  
ターゲット: 30 clip 到達後に go/no-go 再判定。

### 将来（ゲート通過後）

1. CNN backbone 検討（E2E-Spot 相当、~4.5M params）← データが 20-30 clip に増えてから。
2. TFLite export → on-device swap（`react-native-fast-tflite` は既存、`RallyWindow[]` contract を引き継ぐ）。

---

## 変更ファイル一覧

```
app/session/[id]/auto-score.tsx           # Phase 1.5: 実動画時間でスキャン
scripts/eval/rally_state/__init__.py      # 新規
scripts/eval/rally_state/rasterize.py    # 新規（Codex）
scripts/eval/rally_state/extract_features.py  # 新規（Codex）
scripts/eval/rally_state/model.py        # 新規（Codex）
scripts/eval/rally_state/train.py        # 新規（Codex）
scripts/eval/rally_state/predict.py      # 新規（Codex）
scripts/eval/prefill-label.ts            # 新規（Claude）
eval/datasets/fixed-camera-v2/README.md  # expansion protocol 更新
requirements-eval.txt                    # torch>=2.2, librosa>=0.10 追加
package.json                             # eval:prefill スクリプト追加
```
