# Phase B: ボール追跡モデルを Perception 層として検証

**日付**: 2026-05-22  
**対象データセット**: `fixed-camera-v2` (8 clip)  
**ベースライン**: `iter-v2-expanded-blob1` aggregate F1 = **0.433**

## 背景

`fixed-camera-v2` expanded 8clip 評価において、motion/blob ベースの手法は構造的な天井に達した。

- blob baseline: F1 = **0.433**
- 実験的ベスト (LOCO 最適化): F1 = **0.487** (regression guard で reject)
- 4+ アプローチすべて reject

TrackNet V1 gate (iter-tracknet-gate2-lite) は CPU 推論 + stride=180 + 30 triplet のみで AUC 0.520–0.597、すべて閾値 0.65 以下だった。失敗の主因は以下の 2 つの交絡：

1. **CPU 限定** — dense 推論が現実的でなく stride=180 に切り詰め
2. **gate としての使用** — per-frame AUC のみを測定し、軌跡を perception 出力として使っていなかった

本環境で **MPS (Apple GPU) が使用可能** (`torch.backends.mps.is_available()=True`, torch 2.2.2) と判明したため、Phase B を再評価する。

## Phase B の方針

- **ラダー**: ① TrackNet V1 (MPS 再評価) → ② WASB-SBDT → ③ TOTNet
- **役割**: codex = 推論アダプタ (`track-ball.py`)、Claude = 統合・評価
- **目標**: clean-set event F1 **0.85**。最低 blob baseline 0.433 を有意に上回ること。

## Step 0: アセット確認

- v2 clips/ に 5 新規 MP4 あり。
- v1 frames/ に muko-clip1 (18004 frames @ 30fps)、fukui-clip1 (1801 frames @ 3fps)。
- muko-clip2 は v1 clips/ に MP4 あり。

## Step 1: 推論アダプタ (track-ball.py)

codex が `scripts/eval/track-ball.py` を実装。Claude が以下の bug を修正。

### fps 検出バグの修正

muko-clip1 の 500-frame テストで `sourceFps: 3.0, lowFps: True` が出力された（誤）。v1/frames に 18004 frames あるが `clipDurationSec` が label に無いため default 3.0 に落ちた。

**修正**: frame count > 5000 の場合 30fps を返すヒューリスティック追加（tracknet-gate.py と同手法）。

```python
if len(paths) > 5000:
    return 30.0
```

**修正後**: `sourceFps: 30.0, effectiveFps: 15.0, lowFps: False` — 正常。

### MPS タイミング計測

500-frame テスト (stride=2, muko-clip1):
- `20.12s user, 4.07s system, 23% CPU, 1:41.68 total`
- **~4.9 frames/sec on MPS**

Full-clip 見積もり:
- muko-clip1 (stride=4, 4501 inferences): ~15 min
- 900s clips (stride=4): ~23 min/clip
- 全 8 clips: **~2時間**

### 実行コマンド (全 8 clip)

```bash
# muko-clip1, muko-clip2 (30fps frames/mp4): stride=4
python3.11 scripts/eval/track-ball.py --dataset fixed-camera-v2 \
  --clip-id yt-maitou-suzumura-muko-clip1 --stride 4 --device auto --overwrite

# fukui-clip1 (3fps frames): stride=1
python3.11 scripts/eval/track-ball.py --dataset fixed-camera-v2 \
  --clip-id yt-maitou-suzumura-fukui-clip1 --stride 1 --device auto --overwrite

# 5 new v2 clips (30fps mp4): stride=4
python3.11 scripts/eval/track-ball.py --dataset fixed-camera-v2 \
  --clip-id yt-29hnqxtyuzm-clip1 --stride 4 --device auto --overwrite
# ... (全 5 clip)
```

### 軌跡の目視確認 (muko-clip1 first 33s)

Confidence 分布 (500-frame テスト):
- `[0.0, 0.1)`: 88.2%（不可視）
- `[0.1, 0.5)`: 5.4%
- `[0.5, 1.0)`: 6.4%（高信頼度検出）

**バイモーダル分布** — ほとんどが near-zero（不可視）、残りが 0.8-0.9（高信頼度検出）。

GT 第 1 rally: [11s–27s]  
高信頼度検出 (conf > 0.5): 12.9s, 13.0s, 13.3s, 13.5s, 15.9s, 16.1s, 21.5s, 22.2s, ... 33s (ongoing)

→ **GT 内での密クラスター確認済み**。5.7s, 8.8s の pre-rally 検出は gap > 4s かつ run < 4s なので min_dur フィルタで除去される見込み。

## Step 2: trajectory-rally.py

`scripts/eval/trajectory-rally.py` を新設。`rallySegment.ts` の `mergeDetectionsIntoWindows` + `refineWindowsWithDetections` を Python に移植。

主要パラメータ (デフォルト):
- `min_confidence`: 0.35
- `gap_tol`: 4.0s
- `start_pad`: 3.0s / `end_pad`: 4.0s
- `min_dur`: 4.0s / `max_dur`: 30.0s
- `speed_boost`: enabled (`min_speed=0.02`)

## Step 3: 評価 (実行待ち)

全 8 clip 推論は 2026-05-22 22:15 JST に開始。ETA ~2時間（深夜0時頃）。

### 実行予定コマンド

```bash
# デフォルトパラメータ
python3.11 scripts/eval/trajectory-rally.py \
  --run-id iter-tracknet-v1-rally1 \
  --model tracknet-v1 \
  --dataset fixed-camera-v2

npm run eval:score -- \
  --run-id iter-tracknet-v1-rally1 \
  --dataset fixed-camera-v2 \
  --baseline-run-id iter-v2-expanded-blob1
```

### パラメータ調整候補 (初期評価後)

| 変数 | デフォルト | 試す範囲 | 理由 |
|---|---|---|---|
| min_confidence | 0.35 | 0.2, 0.5 | TrackNet の信頼度分布がバイモーダルのため |
| gap_tol | 4.0s | 6.0s, 8.0s | ラリー中の一時的不可視区間が長い可能性 |
| start_pad / end_pad | 3/4s | 2/3s, 4/5s | 境界精度調整 |

## 採用基準 (ロードマップ準拠)

- **目標**: clean-set event F1 ≥ **0.85**
- **最低ライン**: baseline 0.433 を有意に上回る（+0.05 以上が望ましい）
- **production 採用ゲート**: aggregate F1 ≥ baseline +0.02 かつ clip-type regression < -0.05

---

## 評価結果 (3 seed clips — 2026-05-22 22:49 JST)

全 8 clip 推論のうち seed 3 clip 完了時点の中間結果。

### Confidence 分布の観察

| Clip | visible_frac | 特徴 |
|---|---|---|
| muko-clip1 | 19.4% | バイモーダル（大半 near-zero、検出時は 0.8-0.9） |
| muko-clip2 | 13.8% | 同上 |
| fukui-clip1 | **51.5%** | フェンス起因の偽陽性。conf>=0.9 でも 39.8%残存 |

**fukui-clip1 の問題**: フェンスのパターンが TrackNet V1 を混乱させ、ほぼ全フレームで高信頼度の誤検出を発生させる。閾値調整では解決不可。

### TrackNet V1 seed 3-clip スコア (iter-tv1-seed-g4md4: gap_tol=4, min_dur=4)

| Clip | Blob Baseline | TrackNet V1 | Delta |
|---|---|---|---|
| muko-clip1 | 0.111 | **0.343** | **+0.232** ✅ |
| muko-clip2 | 0.438 | 0.216 | -0.222 ❌ |
| fukui-clip1 | 0.652 | 0.133 | -0.519 ❌ |
| **Aggregate** | **0.400** | **0.231** | **-0.169** ❌ |

※ Blob aggregate は 3 clip のみで計算。

**muko-clip1 最良パラメータ** (単一 clip 最適化):
- gap_tol=4.0, min_dur=2.5: F1=**0.410** (+0.299)
- gap_tol=4.0, min_dur=4.0: F1=**0.343** (+0.232)

**muko-clip2 問題**: ラリー間で偽陽性ウィンドウが多発 (22 detected vs 15 GT)。ボールが実際に存在する区間でも検出位置がずれている。

**fukui-clip1 問題**: フェンス遮蔽により confidence 閾値に依存できない構造的失敗。

### 中間判定

seed 3 clip では regression guard 発動（-0.05 超過複数）。残り 5 clip が成否を左右する。

**楽観シナリオ**: 新規 5 clip がオープンコートで TrackNet に有利 → aggregate が baseline 超え。  
**悲観シナリオ**: フェンス/遮蔽系が 1 clip でも含まれれば aggregate 改善は困難。

→ 全 8 clip 完了後に最終判定。

---

## 追加評価: yt-29hnqxtyuzm-clip1 (新規 v2 clip)

- visible_frac=**51.1%**, in=33.8%, out=17.3%, ratio=1.95x (GOOD ratio だが絶対値が高い)
- gap_tol=4.0, min_dur=4.0 → **1 window** detected (球が51%のフレームに存在 → gap < 4s がほぼゼロ → 870秒全体が1つの mega-window に)
- F1=**0.074** vs blob **0.545** → **regression -0.471**

## 4-clip 部分評価結果 (2026-05-22 23:25 JST)

8 clip 推論はまだ実行中だが、4 clip の時点で採用ゲート判定が確定した。

### per-clip F1 比較

| Clip | Blob Baseline | TrackNet V1 | Delta | 判定 |
|---|---|---|---|---|
| yt-29hnqxtyuzm-clip1 | 0.545 | 0.074 | **-0.471** | ❌ REJECT |
| yt-maitou-suzumura-fukui-clip1 | 0.652 | 0.133 | **-0.519** | ❌ REJECT |
| yt-maitou-suzumura-muko-clip1 | 0.111 | 0.343 | **+0.232** | ✅ |
| yt-maitou-suzumura-muko-clip2 | 0.438 | 0.216 | **-0.222** | ❌ REJECT |
| **4-clip aggregate** | **0.437** | **0.192** | **-0.245** | ❌ |

採用ゲート `aggregate F1 ≥ baseline +0.02 かつ regression < -0.05` の両方が大幅に不合格。

### 失敗の根本原因分析

**2種類の失敗パターンを確認:**

**Pattern A — 高 visible rate (51-52%), ratio 良好 (2x) → mega-window**
- yt-29hnqxtyuzm, fukui-clip1
- フレームの約半分で高信頼度検出 → gap_tol=4s 内に常に何かを検出 → 全 clip が 1〜6 の巨大 window に収束
- 26 または 24 の GT rally に対して 1〜6 window → recall 壊滅

**Pattern B — 低 visible rate (14-19%), ratio 不良 (<1x) → FP 過多**
- muko-clip2 (ratio=0.48x): out-rally 検出が in-rally の2倍
- 空間・信頼度の両面で FP と TP の分布が同一 → フィルタリング不可能

**なぜ muko-clip1 のみ改善したか:**
- blob が極端に失敗していた (0.111) → TrackNet の不完全な検出 (0.343) でも上回る
- muko-clip1 の blob FP 率が異常に高かったため、相対改善が見られた
- TrackNet の絶対精度は低い (ratio=0.85x) が、blob の失敗と比べると「まし」

**根本的ドメインギャップ:**
- TrackNet V1 は放送用テニス映像 (プロ、ハイライト、ズームイン) で学習
- 本データセットは固定カメラ・広角・アマチュア練習映像
- 背景の fence パターン、コート上の複数ボール、選手の装備品、グレアを tennis ball と区別できない

### 中間結論: Phase B ladder step 1 (TrackNet V1) = **REJECT**

残り 4 clip の結果によらず、採用ゲートは通過しない。  
(残り 4 clip が blob F1 を維持したとしても、4-clip weighted average は baseline を下回る)

---

## 最終評価結果 (5 clip 確定 — 2026-05-23 00:20 JST)

残り 3 clip (aiax, na9s4, wuywqtrg) は推論中だが、5 clip 時点で採用ゲート判定が確定した。

### 5-clip パラメータスイープ結果

**Blob baseline (5-clip mean): 0.423**

| Clip | Blob | tv1-g4md40 | tv1-g4md25 | tv1-g6md40 | tv1-g4md20 | Best delta |
|---|---|---|---|---|---|---|
| yt-29hnqxtyuzm-clip1 | 0.545 | 0.074 | 0.074 | 0.074 | 0.074 | **-0.471** |
| yt-61l1sw26dtg-clip1 | 0.367 | 0.256 | 0.256 | 0.000 | 0.256 | **-0.111** |
| yt-maitou-suzumura-fukui-clip1 | 0.652 | 0.133 | 0.133 | 0.000 | 0.133 | **-0.519** |
| yt-maitou-suzumura-muko-clip1 | 0.111 | 0.343 | **0.410** | 0.250 | **0.410** | **+0.299** |
| yt-maitou-suzumura-muko-clip2 | 0.437 | 0.216 | 0.250 | 0.182 | 0.250 | **-0.187** |
| **Aggregate** | **0.423** | **0.205** | **0.225** | **0.101** | **0.225** | **-0.198** |

**採用ゲート判定**: `aggregate F1 ≥ baseline + 0.02` → **FAIL** (0.225 < 0.453)  
**regression guard**: yt-29hnqxtyuzm, fukui, muko-clip2 で -0.111〜-0.519 → **全設定 REJECT**

### シグナル比 (5 clip)

| Clip | visible_frac | ratio | 判定 | 失敗パターン |
|---|---|---|---|---|
| yt-29hnqxtyuzm-clip1 | 51.1% | 1.95x | ⚠️ | Pattern A: mega-window 1個 |
| yt-61l1sw26dtg-clip1 | 58.7% | 1.99x | ⚠️ | Pattern A: 13 windows (部分的) |
| yt-maitou-suzumura-fukui-clip1 | 51.5% | 2.00x | ⚠️ | Pattern A: フェンス偽陽性 |
| yt-maitou-suzumura-muko-clip1 | 19.4% | 0.85x | ⚠️ | Pattern B: ratio 低いが blob baseline が極端に低いため相対改善 |
| yt-maitou-suzumura-muko-clip2 | 13.8% | 0.48x | ❌ | Pattern B: FP が TP の 2倍 |

**yt-61l1sw26dtg-clip1 の観察**: visible 58.7% だが 13 window に分散 → 一部ラリーをカバー。しかし blob より低い (0.256 vs 0.367)。Pattern A の「軽度版」。

### gap_tol=6.0 の崩壊

g6md40 で fukui と yt-61l が F1=0.000。gap_tol を広げると:
- 高 visible クリップでは隣接する検出が全結合 → 1 mega-window → recall=0, precision=0 (IoU 不満足)
- gap_tol 拡大は Pattern A をさらに悪化させる

### 最終判定

**TrackNet V1 (事前学習のみ): REJECT**

根本原因: **ドメインギャップ**。TrackNet V1 は放送テニス映像で学習済みで、固定カメラ・広角・アマチュア映像の背景（フェンス、コート外物体）を tennis ball と区別できない。事前学習重みを使う限り、パラメータ調整での改善には構造的な上限がある。

### WASB-SBDT (ladder step 2) の展望

事前調査済み:
- **CUDA ハードコード**: `assert 0, 'device=cpu not supported'` → MPS/CPU パッチが必要
- **重み**: Google Drive（要手動DL）
- **アーキテクチャ**: N-frame → heatmap。TrackNet V1 と本質的に同じ構造 (spatial ball localization)。temporal tracking は別モジュール
- **同一のドメインギャップ問題が予想される**: 学習データが同じ「放送テニス」ドメイン

**勧告**: WASB-SBDT は実装コスト（CUDA→MPS patch + Google Drive DL + adapter）が高く、TrackNet V1 と同一のドメインギャップ問題が根本原因。同じ結果になる可能性が高い。

**次の選択肢**:
1. **Fine-tune**: ローカルデータで学習させて初めてドメインギャップを解消できる。本サイクル対象外 → escalate。
2. **Stage 1 再スコープ**: blob F1=0.433 で足りる上位機能に集中し、Phase B をここで閉じる。
3. **ラベル精緻化 (Phase A) 先行**: より細かいラベルで blob の天井を再測定し、0.433 が真の限界かを確認する。

**現時点の推奨**: Phase B (TrackNet V1 + WASB-SBDT) クローズ。Stage 1 ラベル精緻化 (Phase A) または Production 運用での許容判断 (blob F1=0.433 を暫定採用) を検討。

---

## 推論完了後の補記 (残り 3 clip)

<!-- yt-aiax, yt-na9s4, yt-wuywqtrg の推論完了後に 8-clip 最終スコアを記入 -->
<!-- 採用判定は 5-clip 時点で確定済み (REJECT) -->
