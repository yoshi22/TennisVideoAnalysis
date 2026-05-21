# 2026-05-21 開発ログ: fixed-camera 評価の最新状況

**日付**: 2026-05-21  
**対象**: Stage 1 fixed-camera rally window detection  
**最新コミット**: `a378024 feat(eval): improve fixed-camera rally experiments`  
**GitHub**: `origin/master` へ push 済み  
**現時点の採用 run**: `iter-score-blob-anchor8`

---

## 要約

fixed-camera v1 の 3 clip dev set では、現時点の最良 run は `iter-score-blob-anchor8`。

`iter-score-blob-anchor8` は score transition を anchor として使い、blob density と補助 fallback を組み合わせる方針。aggregate Event F1 は **0.741** で、honest 3-clip baseline `iter-fc6-3clip` から改善している。ただし Stage 1 目標 F1 0.85 には未達。

追加で score 非依存の motion/flow/geometry fallback を実装・検証したが、leave-one-clip-out で汎化せず、aggregate F1 は **0.727** に後退した。そのため `iter-cv-fallback1` は不採用とした。

---

## 実装された主な変更

### 1. score transition anchor 系の改善

採用 run: `iter-score-blob-anchor8`

- score event 周辺をラリー境界候補として利用。
- blob density を使って score anchor から実際の rally window を補正。
- fixed-camera 3 clip で regression guard を通過。
- 現時点の production 候補として扱う。

### 2. score 非依存 CV fallback の追加

追加ファイル:

- `scripts/eval/cv-rally-fallback.py`

実装内容:

- scoreboard ROI / score event を読まない fallback。
- frame diff, cleaned motion, connected components, Farneback optical flow を特徴量化。
- per-clip rank normalization と rolling stats を追加。
- leave-one-clip-out で `HistGradientBoostingClassifier(class_weight="balanced")` を学習。
- base run `iter-score-blob-anchor8` と重なる candidate は除外し、非重複 fallback window だけを追加。

判定:

- `iter-cv-fallback1` は不採用。
- held-out AUC がランダム近傍で、clip 間汎化の根拠が弱い。
- 追加データ取得は、現 feature family の妥当性が確認できなかったため今回は見送った。

### 3. 生成物の ignore 整理

`.gitignore` を更新し、評価用の大きい生成物を追跡対象から外した。

- `eval/datasets/**/frames30/`
- `eval/datasets/**/audio/`
- `eval/datasets/**/pose/`
- `eval/datasets/**/ball-tracks/`
- `scripts/eval/__pycache__/`
- `*.ipa`
- `*.pt`

---

## 評価結果

### 採用: `iter-score-blob-anchor8`

| clip | F1 | Precision | Recall | Detected / True |
|---|---:|---:|---:|---:|
| `yt-maitou-suzumura-fukui-clip1` | 0.720 | 0.692 | 0.750 | 26 / 24 |
| `yt-maitou-suzumura-muko-clip1` | 0.769 | 0.714 | 0.833 | 21 / 18 |
| `yt-maitou-suzumura-muko-clip2` | 0.733 | 0.733 | 0.733 | 15 / 15 |
| **Aggregate** | **0.741** | **0.713** | **0.772** | - |

Aggregate details:

- IoU mean: `0.653`
- IoU p10: `0.526`
- boundary start MAE: `4.021s`
- boundary end MAE: `3.738s`
- FP seconds / minute: `10.892`

### 不採用: `iter-cv-fallback1`

| clip | F1 | 変化 | 備考 |
|---|---:|---:|---|
| `yt-maitou-suzumura-fukui-clip1` | 0.720 | +0.000 | fallback 追加なし |
| `yt-maitou-suzumura-muko-clip1` | 0.750 | -0.019 | fallback が FP を追加 |
| `yt-maitou-suzumura-muko-clip2` | 0.710 | -0.024 | fallback が FP を追加 |
| **Aggregate** | **0.727** | **-0.014** | 不採用 |

Frame-level AUC:

| test clip | AUC | 判定 |
|---|---:|---|
| `yt-maitou-suzumura-fukui-clip1` | 0.536 | ランダム近傍 |
| `yt-maitou-suzumura-muko-clip1` | 0.432 | 方向反転 |
| `yt-maitou-suzumura-muko-clip2` | 0.509 | ランダム近傍 |

---

## Web 調査と判断

更なる精度改善に向けて、以下を調査した。

- TrackNet paper: https://arxiv.org/abs/1907.03698
- TrackNetV4: https://arxiv.org/abs/2409.14543
- E2E-Spot / SPOT repo: https://github.com/jhong93/spot
- E2E-Spot paper: https://arxiv.org/abs/2207.10213
- OpenSportsLab tennis action spotting dataset: https://huggingface.co/datasets/OpenSportsLab/soccernetpro-localization-tennis

判断:

- TrackNet 系は球追跡として妥当だが、既存の `iter-tracknet-gate1` では採用に足る改善が出ていない。
- TrackNetV4 / motion attention 系は fixed-camera との相性は良いが、モデル導入・学習・重み管理のコストが大きい。
- E2E-Spot 系の global/local temporal context は方向性として有効だが、現 dev set 3 clip では deep temporal model の評価が過学習に寄りやすい。
- OpenSportsLab tennis dataset は broadcast action spotting 寄りで、今回の fixed-camera rally window 検出とは分布が異なる。

結論:

現時点では追加データ取得より、score transition anchor を正式な入力前提にするか、ball tracking を perception 層として本格導入するかを先に決める必要がある。

---

## 検証済みコマンド

```bash
/usr/local/bin/python3.11 -m py_compile scripts/eval/cv-rally-fallback.py scripts/eval/score-blob-anchor.py
git diff --check
npm run type-check
npm test -- --runInBand

/usr/local/bin/python3.11 scripts/eval/cv-rally-fallback.py \
  --run-id iter-cv-fallback1 \
  --base-run-id iter-score-blob-anchor8

npm run eval:score -- \
  --run-id iter-cv-fallback1 \
  --dataset fixed-camera-v1 \
  --baseline-run-id iter-score-blob-anchor8

/usr/local/bin/python3.11 scripts/eval/analyze-errors.py --run-id iter-cv-fallback1
```

結果:

- Python compile: pass
- diff whitespace check: pass
- TypeScript type-check: pass
- Jest: 11 suites / 76 tests pass
- eval scoring: `iter-cv-fallback1` は regression guard 上は reject されないが、aggregate F1 が `iter-score-blob-anchor8` より低いため不採用

---

## 残課題

`iter-score-blob-anchor8` は F1 0.741 まで到達したが、F1 0.85 まで gap `0.109` が残る。

主な課題:

- score event timing が早い、または欠ける箇所で rally window が分離できない。
- 短ラリーで boundary miss が残る。
- score 非依存の motion/flow feature は clip 間汎化しない。
- scoreboard / score transition への依存をプロダクト仕様として許容するか、純CVとして ball tracking を強化するかの判断が必要。

---

## 次の開発方針

### Option A: score transition anchor を正式採用する

短期で最も現実的。ユーザー入力、手動点数補正、または score OCR と組み合わせ、score transition を rally boundary の信頼できる anchor として扱う。

次にやること:

- score event の early / missing を吸収する multi-anchor window merge を実装。
- clip2 の未分離 FN を重点的に削る。
- UI 側では、手動点数入力やスコア確認と rally segmentation を結びつける。

### Option B: ball tracking を本格導入する

scoreboard に依存しない方向を維持するならこちら。TrackNetV4 / motion attention 系の再現または軽量モデル導入が必要。

次にやること:

- fixed-camera 用の ball visibility label を少量追加。
- 既存 `tracknet-gate` を gate ではなく perception output として再設計。
- ball trajectory confidence を rally segmentation に直接渡す。

### Option C: eval dataset を拡張する

手法選択の信頼性を上げるための基盤作業。

次にやること:

- fixed-camera clip を 3 本から 8-10 本へ拡張。
- train/dev/test split を固定。
- score anchor あり / なしの 2 系統で leaderboard を分ける。

---

## 現時点の結論

次に実装へ進むなら、**Option A: score transition anchor の正式採用** が最も費用対効果が高い。

純CV fallback は今回の検証では不採用。score 非依存を続ける場合は、既存の motion/flow feature 追加ではなく、ball tracking / motion attention を perception として導入する段階に進むべき。

---

## 追記: 一般ユーザー動画向け scoreless 改善（2026-05-21）

### 方針変更

一般ユーザーが撮影する動画では、放送映像のような得点表示が動画内にない。そのため、短期の最高精度を出している `iter-score-blob-anchor8` は比較参考として残しつつ、今回の改善対象は **scoreboard / score-state を使わない scoreless pipeline** に戻した。

採用基準:

- baseline は scoreless の `iter-fc6-3clip`。
- score ROI、score event、score-state gate、`iter-score-*` は入力として使わない。
- clip 別 special-case は入れない。
- aggregate F1 が baseline を上回り、各 clip が大きく悪化しない場合だけ production へ移植する。

### 実装

追加:

- `scripts/eval/scoreless-rally-refine.py`

production 反映:

- `src/services/ball/core/rallySegment.ts`
- `__tests__/services/ball/core/rallySegment.test.ts`

手法:

- 既存 scoreless run の窓を、映像 activity だけで後処理する。
- frame diff から `blobCount` と上下同時 motion を再計算する。
- 既存の広めの padding は維持しつつ、先頭・末尾を最大 2 秒だけ activity 側へ寄せる。
- inactive window はデフォルトでは捨てない。初期実験で prune が muko-clip1 を悪化させたため。
- split は 18 秒以上の窓かつ 6 秒以上の activity gap がある場合のみ候補にする。

scoreless refinement の主要パラメータ:

```text
activeBlobThreshold=11
bridgeBlobThreshold=7
bridgeMinDualZonePx=320
refinedStartPadSec=2.5
refinedEndPadSec=3.0
maxTrimSec=2.0
splitMinWindowSec=18.0
splitQuietSec=6.0
pruneInactiveWindows=false
```

### 結果: `iter-scoreless-refine1`

baseline: `iter-fc6-3clip`

| clip | baseline F1 | refined F1 | delta |
|---|---:|---:|---:|
| `yt-maitou-suzumura-fukui-clip1` | 0.652 | 0.696 | +0.044 |
| `yt-maitou-suzumura-muko-clip1` | 0.769 | 0.769 | +0.000 |
| `yt-maitou-suzumura-muko-clip2` | 0.375 | 0.437 | +0.062 |
| **Aggregate** | **0.599** | **0.634** | **+0.035** |

Aggregate details:

- Precision: `0.618`
- Recall: `0.656`
- IoU mean: `0.698`
- IoU p10: `0.545`
- Start MAE: `2.79s`
- End MAE: `4.02s`
- FP seconds / minute: `13.58`

scoreあり参考値:

- `iter-score-blob-anchor8`: aggregate F1 `0.741`

判定:

- `iter-scoreless-refine1` は scoreless baseline を上回った。
- 各 clip の F1 悪化はなし。
- regression guard passed。
- production の `mergeDetectionsIntoWindows` に軽量な visual boundary refinement として移植した。

### 検証済みコマンド

```bash
/usr/local/bin/python3.11 -m py_compile scripts/eval/scoreless-rally-refine.py

/usr/local/bin/python3.11 scripts/eval/scoreless-rally-refine.py \
  --run-id iter-scoreless-refine1 \
  --base-run-id iter-fc6-3clip

npm run eval:score -- \
  --run-id iter-scoreless-refine1 \
  --dataset fixed-camera-v1 \
  --baseline-run-id iter-fc6-3clip

/usr/local/bin/python3.11 scripts/eval/analyze-errors.py --run-id iter-scoreless-refine1
npm run type-check
npm test -- --runInBand __tests__/services/ball/core/rallySegment.test.ts
npm test -- --runInBand
```

### 残課題

scoreless pipeline は F1 `0.634` まで改善したが、scoreありの `0.741` とはまだ差がある。

次の改善候補:

1. muko-clip2 の no-overlap FP と possible-merge FP を減らす。
2. scoreless でも使える lightweight ball tracking を perception feature として追加する。
3. 一般ユーザー固定カメラ動画を 8-10 本に増やし、scoreless leaderboard を固定する。
