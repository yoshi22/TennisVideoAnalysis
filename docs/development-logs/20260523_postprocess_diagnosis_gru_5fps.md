# Post-processing 診断 + GRU 5fps 訓練

**日付**: 2026-05-23（同日、第2ラウンド）
**前回**: `20260523_strategic_pivot_direct_rally_state.md`
**前回のゴール**: TCN 100ep 訓練後に event F1 を確認

---

## 100ep TCN 結果の診断

### frame-level vs event-level の乖離

```
TCN 100ep (rally-state-tcn-v1-full):
  Frame-level LOCO: F1=0.703  P=0.631  R=0.794
  Event-level (IoU≥0.5): F1=0.086
```

frame F1=0.703 なのに event F1=0.086 という大きな乖離。

### 根本原因: 巨大ウィンドウ問題

post-processing パラメータ（元設定: lo=0.35, hi=0.55, gap_tol=3s, start_pad=3s, end_pad=4s）が
**merge radius = start_pad + gap_tol + end_pad = 10s** を生み出しており、
9-15s の inter-rally gap が全部マージされる。

| クリップ | GT ラリー数 | 検出ウィンドウ数 | 最大ウィンドウ長 | 問題 |
|---|---|---|---|---|
| yt-29hnqxtyuzm-clip1 | 26 | 5 | - | gap 合併 |
| yt-61l1sw26dtg-clip1 | 26 | 11 | - | gap 合併 |
| yt-aiax-p6llfo-clip1 | 16 | 4 | - | gap 合併 |
| yt-na9s4gjzel0-clip1 | 25 | 10 | **154s** (4ラリー分) | gap 合併 |
| yt-wuywqtrg4rw-clip1 | 15 | **1** | **504s** (全クリップ) | モデルが全フレームを "play" 予測 |

na9s4gjzel0 の 154s ウィンドウは4ラリー（各27s）を飲み込み、
各ラリーとの IoU は (27/154) ≈ 0.175 → IoU≥0.5 を達成できない。

wuywqtrg4rw: GT gap = 6-11s。モデルが gap 期間も prob ≥ 0.35 を維持 → 全クリップが1ウィンドウ。

---

## post-processing チューニング

新規ツール: `scripts/eval/rally_state/tune_postprocess.py`

```bash
# チェックポイント再利用（再訓練不要）で post-processing パラメータを試せる
python3.11 scripts/eval/rally_state/tune_postprocess.py \
  --source-run-id rally-state-tcn-v1-full \
  --run-id <new-run-id> \
  --hysteresis-lo ... --hysteresis-hi ... --gap-tol ... --start-pad ... --end-pad ...
```

### 試したパラメータ

| run-id | lo | hi | gap_tol | start_pad | end_pad | smooth | Event F1 |
|---|---|---|---|---|---|---|---|
| tcn-v1-full (元) | 0.35 | 0.55 | 3.0s | 3.0s | 4.0s | なし | 0.086 |
| pp2 | 0.35 | 0.50 | **0s** | 0.5s | 1.0s | なし | **0.174** |
| pp3 | 0.45 | 0.55 | 0s | 0.3s | 0.5s | なし | - |
| pp4 | 0.40 | 0.52 | 0s | 0.3s | 0.5s | 9f | 0.135 |

**最良: pp2** (event F1=0.174)。gap_tol=0、小パッドが最重要。

### pp2 詳細スコア

```
yt-29hnqxtyuzm-clip1:  F1=0.190  P=0.250  R=0.154  IoU=0.608
yt-61l1sw26dtg-clip1:  F1=0.367  P=0.391  R=0.346  IoU=0.664
yt-aiax-p6llfo-clip1:  F1=0.286  P=0.263  R=0.313  IoU=0.583
yt-maitou-suzumura-fukui-clip1:  F1=0.140  P=0.158  R=0.125  IoU=0.658
yt-maitou-suzumura-muko-clip1:  F1=0.188  P=0.214  R=0.167  IoU=0.537
yt-maitou-suzumura-muko-clip2:  F1=0.176  P=0.158  R=0.200  IoU=0.766
yt-na9s4gjzel0-clip1:  F1=0.049  P=0.063  R=0.040  IoU=0.814
yt-wuywqtrg4rw-clip1:  F1=0.000  P=0.000  R=0.000  IoU=0.000
Aggregate Event F1: 0.174  FP=37.06s/min
```

IoU_mean=0.579 — マッチした窓の品質は良い。問題は「マッチする窓の数が少ない」こと。

### post-processing の天井

lo/hi スムージング等の追加チューニングは 0.174 の天井を破れなかった。
**モデルの予測確率の分布自体が問題**:

- wuywqtrg4rw: 全フレーム prob≥0.35 → どんな設定でも1ウィンドウ
- na9s4gjzel0: 一部の gap が prob>lo で、ヒステリシスが抜けない

post-processing で解決できない理由:
> モデルが inter-rally gap を "play" と予測している問題を後処理では修正できない。
> モデル自体が gap 中に低確率を出力する必要がある。

---

## 根本原因: データ飢餓

8-clip LOCO では各フォールドが 7 clip で訓練。wuywqtrg4rw の tight gap パターン（6-11s）
は他の 7 clip に類似例がないため、モデルが汎化できない。

研究文献が明記: 「8 clip での判定は主にデータ飢餓を測定している」

**ゲート: 30-60 clip 到達前は event F1 の絶対値で合否判定しない。**

---

## 次の実験: GRU 5fps

TCN の問題:
- receptive field ≈ 10s (at 3fps) — 9-12s gap をギリギリしかカバーしない
- 単方向 causal 畳み込み — gap 直後の文脈を使えない

GRU のアドバンテージ:
- 双方向 → gap 直後の "準備" パターンも使える
- hidden state が LOCO 訓練の範囲内で長距離依存を学べる
- 5fps → 9-12s gap に 45-60 フレームの分解能

```bash
python3.11 scripts/eval/rally_state/train.py \
  --dataset fixed-camera-v2 --run-id rally-state-gru-v1-5fps \
  --fps 5 --model gru --epochs 150 --lr 0.001
```

feature 再抽出済み（各クリップ 2550-4500 フレーム at 5fps）。
訓練中（2026-05-23 時点）。

### スコアリング手順（訓練完了後）

```bash
# pp2 相当パラメータで post-processing
python3.11 scripts/eval/rally_state/tune_postprocess.py \
  --source-run-id rally-state-gru-v1-5fps \
  --run-id rally-state-gru-v1-5fps-pp \
  --dataset fixed-camera-v2 \
  --hysteresis-lo 0.35 --hysteresis-hi 0.50 \
  --gap-tol 0 --start-pad 0.5 --end-pad 1.0 --min-dur 2.0

npm run eval:score -- --run-id rally-state-gru-v1-5fps-pp \
  --dataset fixed-camera-v2 --baseline-run-id iter-v2-expanded-blob1
```

---

## 優先度マップ

| 優先度 | アクション | 期待 event F1 改善 |
|---|---|---|
| **最高** | ラベル拡張 8→25-30 clip | +0.2-0.5 |
| 高 | GRU 5fps 結果確認 | +0.05-0.15? |
| 中 | TCN receptive field 拡大 (layers 4→6) | 小さい |
| 低 | E2E-Spot CNN backbone | データ 20-30 clip 後に |

**結論**: 最重要タスクはラベル拡張。次回の会話でユーザーが新クリップを追加するたびに
`npm run eval:run1` + `npm run eval:prefill` でラベル pre-fill を実行し、目視修正する。

---

## 変更ファイル

```
scripts/eval/rally_state/tune_postprocess.py  # 新規（post-processing 高速チューニングツール）
eval/results/rally-state-tcn-v1-pp2/         # 最良 TCN post-process 結果
docs/development-logs/20260523_postprocess_diagnosis_gru_5fps.md  # このファイル
```
