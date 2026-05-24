# クリップ拡張計画 + Modal Labs リモート訓練セットアップ

**日付**: 2026-05-24  
**前回**: `20260524_feature_completion_audio_pose.md`  
**目的**: データ飢餓（8 clip）が根本的制約であることを確認し、クリップ拡張 + 外部 GPU 訓練の戦略と実装ツールを整備する

---

## 背景: feature-completion サイクルで確認された制約

前サイクル（同日）で audio/pose バグ修正後の TCN v2 を評価した結果:

| run | frame F1 | event F1 | 備考 |
|---|---|---|---|
| Blob baseline | — | **0.433** | 現行 production |
| TCN v1 visual-only (pp2) | 0.703 | **0.174** | ML 最良 |
| TCN v2 energy-onset (pp4) | 0.753 | 0.149 | feature 追加後 |
| TCN v2 spectral-flux (pp4) | 0.739 | 0.099 | さらに低下 |

**結論**: feature コードは正しく修正された（gap 検出は解決）。  
event F1 が改善しない根本原因は **8 clip のデータ飢餓**。  
ノイジーな audio feature が 7 clip/fold の少ない訓練データで汎化の邪魔をしている。

---

## 外部 GPU 計算の調査

ローカル MPS（Apple Silicon）に比べ、大量クリップ・高 epoch での訓練を外部 GPU で行う選択肢を検討した。

### 評価した選択肢

| 選択肢 | 特徴 | 適合度 |
|---|---|---|
| Google Colab | 無料枠あり、12h セッション制限、データ保持なし | ×（長時間訓練に不向き） |
| Modal Labs | サーバーレス、Python-first API、Volume で永続ストレージ | ◎ |
| RunPod | GPU Pod 時間貸し、SSH 可能、手動管理 | △ |
| Vast.ai | 最安値、品質ばらつき大、手動管理 | △ |

### Modal Labs を選択した理由

- **Python-first**: `@app.function` デコレータで既存 `train.py` をそのまま呼べる
- **Volume**: `courtlens-v2-data` で dataset/results を永続化、クリップ追加のたびに全データ再送不要
- **サーバーレス課金**: 訓練時間分のみ課金（T4 GPU ~$0.59/hr）
- **コード管理不要**: RunPod/Vast.ai のような SSH + 手動セットアップが不要

---

## 期待精度の見積もり（Modal Labs + クリップ拡張）

docs/tennis_rally_interval_detection_research.md の推奨 + 現在の診断結果から:

| clip 数 | LOCO fold あたり訓練 | 期待 event F1 | 備考 |
|---|---|---|---|
| 8（現在） | 7 clip | 0.09-0.17 | データ飢餓が支配的 |
| 25-30 | 24-29 clip | 0.55-0.72 | 有意な改善が期待 |
| 60 | 59 clip | 0.78-0.88 | ゲート（0.85）到達圏内 |

**なぜ 25-30 clip が次の目標か**:
- LOCO では「残り全て」で訓練するため、fold あたり 24-29 clip が確保できる
- audio/pose feature が 7→24 clip で安定化し、noisy feature の汎化問題が緩和される
- Start/End MAE ≈ 5s の境界精度もデータ増加で改善が期待される

---

## 実装したツール

### 1. `scripts/eval/add-new-clip.py`

新規クリップを eval データセットに追加するオートメーションヘルパー。

**ワークフロー**:
1. stub label JSON を `eval/datasets/<dataset>/labels/<clip-id>.json` に生成（rallies: []）
2. `prepare-fixed-camera-assets.py` で YouTube 動画ダウンロード + フレーム抽出
3. `eval:run1`（blob detector）でウィンドウ予測を生成
4. `eval:prefill` で `<clip-id>_DRAFT.json` を出力
5. 手動修正手順を表示して終了

```bash
python3.11 scripts/eval/add-new-clip.py \
  --url "https://www.youtube.com/watch?v=XXXXXXXXX" \
  --clip-id yt-XXXXXXXXX-clip1 \
  --offset 0 \
  --duration 900 \
  [--dataset fixed-camera-v2]
```

**手動修正後**:
```bash
# _DRAFT を本ラベルにリネーム
mv eval/datasets/fixed-camera-v2/labels/yt-XXXXXXXXX-clip1_DRAFT.json \
   eval/datasets/fixed-camera-v2/labels/yt-XXXXXXXXX-clip1.json

# バリデーション
python3.11 scripts/eval/validate-rally-labels.py --dataset fixed-camera-v2

# (オプション) pose 抽出
python3.11 scripts/eval/pose-extract.py --dataset fixed-camera-v2 --clip yt-XXXXXXXXX-clip1
```

ラベル品質基準: **境界精度 ±3s、1 クリップあたり ≥15 ラリー推奨**。

---

### 2. `scripts/eval/modal_train.py`

Modal Labs リモート GPU 訓練ラッパー。3 サブコマンド。

#### セットアップ（初回のみ）

Modal は packaging>=24 を要求するため、このリポジトリの Python 環境と衝突する。別 venv を使う:

```bash
python3.11 -m venv ~/.venvs/modal-venv
source ~/.venvs/modal-venv/bin/activate
pip install modal
modal token new   # ブラウザ認証
```

#### サブコマンド

**upload** — データセットとスクリプトを Modal Volume に同期

```bash
python3.11 scripts/eval/modal_train.py upload --dataset fixed-camera-v2
```

- `eval/datasets/fixed-camera-v2/` → Modal Volume `courtlens-v2-data:/data/eval/datasets/fixed-camera-v2/`
- `scripts/eval/rally_state/` → Modal Volume `courtlens-v2-data:/data/scripts/eval/rally_state/`
- クリップ追加のたびに再実行（差分のみ転送）

**train** — LOCO CV 訓練 + ポスト処理を T4 GPU で実行

```bash
modal run scripts/eval/modal_train.py train \
  --run-id rally-state-gru-v3 \
  --model gru \
  --fps 5 \
  --epochs 200 \
  --dataset fixed-camera-v2
```

- GPU: NVIDIA T4（~$0.59/hr）
- タイムアウト: 3h（30 clip × 200 epoch で ≈30-60 分）
- `train.py` → `tune_postprocess.py` を自動実行
- 結果は Volume に保存（`/data/eval/results/<run-id>/`）

デフォルトポスト処理パラメータ（GRU 向け最適化済み）:
```
hysteresis-lo=0.35  hysteresis-hi=0.50
gap-tol=3.0  start-pad=1.0  end-pad=2.0  min-dur=3.0
```

**download** — 結果をローカルに取得

```bash
modal run scripts/eval/modal_train.py download \
  --run-id rally-state-gru-v3 --also-pp
```

---

## 次サイクルの全体ワークフロー

```bash
# Phase 1: クリップ拡張（目標: 25-30 clip、手動作業）
python3.11 scripts/eval/add-new-clip.py \
  --url "..." --clip-id yt-XXXXXXXXX-clip1 --offset 0 --duration 900
# → _DRAFT.json を動画と見比べて修正 → リネーム → validate

# Phase 2: Modal 訓練（25-30 clip 到達後）
source ~/.venvs/modal-venv/bin/activate
python3.11 scripts/eval/modal_train.py upload
modal run scripts/eval/modal_train.py train \
  --run-id rally-state-gru-v3 --model gru --fps 5 --epochs 200

# Phase 3: ローカルスコアリング
modal run scripts/eval/modal_train.py download --run-id rally-state-gru-v3 --also-pp
npm run eval:score -- \
  --run-id rally-state-gru-v3-pp \
  --dataset fixed-camera-v2 \
  --baseline-run-id iter-v2-expanded-blob1
```

---

## ゲート条件（変更なし）

- **短期**: 25-30 clip → event F1 ≥ 0.55 かつ blob baseline (0.433) 超過
- **中期**: 60 clip → event F1 ≥ 0.85（IoU≥0.5）+ クリップ回帰 ≤ -0.05
- 達成後 → TFLite/Core ML export + on-device swap

---

## 変更ファイル

```
scripts/eval/add-new-clip.py       (新規) クリップ追加オートメーション
scripts/eval/modal_train.py        (新規) Modal Labs リモート訓練ラッパー
```
