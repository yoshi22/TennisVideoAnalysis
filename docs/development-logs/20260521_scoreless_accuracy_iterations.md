# 2026-05-21 開発ログ: scoreless 精度改善 iteration

**目的**: 一般ユーザー動画を想定し、scoreboard / score-state を使わずにラリー区間検出の Event F1 を 0.85 に近づける。  
**開始 baseline**: `iter-scoreless-refine1` aggregate F1 `0.634`  
**停止方針**: 最大 6 iteration、または 2 iteration 連続で aggregate 改善 `+0.01` 未満。

---

## 前提

一般ユーザー動画には放送用の得点表示がないため、`iter-score-blob-anchor8` のような score transition anchor は採用対象から外す。score あり run は参考値としてのみ扱う。

参考値:

| run | 入力 | aggregate F1 |
|---|---|---:|
| `iter-scoreless-refine1` | 映像のみ | 0.634 |
| `iter-score-blob-anchor8` | score transition あり | 0.741 |

---

## Web / YouTube 候補調査

`yt-dlp --flat-playlist` による検索で、一般ユーザー動画または固定カメラに近い候補を抽出した。動画本体は git 管理しない。

候補:

| id | title | url | duration | メモ |
|---|---|---|---:|---|
| `Na9S4gJzel0` | テニステップ 男子シングルス大会 西大宮テニスクラブ | https://www.youtube.com/watch?v=Na9S4gJzel0 | 1:25:39 | 草トーナメント、一般ユーザー寄り |
| `61L1sW26dtg` | 多摩社会人テニス連盟 シングルス | https://www.youtube.com/watch?v=61L1sW26dtg | 37:03 | 社会人シングルス |
| `-FQkEndhdNo` | 草トーナメント 中級シングルス その2 | https://www.youtube.com/watch?v=-FQkEndhdNo | 36:51 | 一般ユーザー寄り |
| `aIAx_p6LlFo` | USTA 4.5 Baseliner vs USTA 4.0 Pusher | https://www.youtube.com/watch?v=aIAx_p6LlFo | 15:12 | 英語圏一般プレー、固定に近い可能性 |
| `WuywQtrG4Rw` | USTA 4.5 vs WTA #800 | https://www.youtube.com/watch?v=WuywQtrG4Rw | 17:09 | 一般/競技混在 |
| `29hnQXTyUzM` | USTA 4.5 Baseliner vs USTA 4.5 Big Hitter | https://www.youtube.com/watch?v=29hnQXTyUzM | 17:39 | 一般プレー |

判断:

- データ拡張は必要。ただし独立ラベル作成は自動化できず、動画視聴による境界確認が必要。
- 今回はまず既存 3 clip でモデル導入の有効性を検証し、候補動画は `fixed-camera-v2` 拡張用 backlog とする。

---

## Iter 0: 現状固定

run: `iter-scoreless-refine1`

| clip | F1 | P | R |
|---|---:|---:|---:|
| `yt-maitou-suzumura-fukui-clip1` | 0.696 | 0.727 | 0.667 |
| `yt-maitou-suzumura-muko-clip1` | 0.769 | 0.714 | 0.833 |
| `yt-maitou-suzumura-muko-clip2` | 0.437 | 0.412 | 0.467 |
| **Aggregate** | **0.634** | **0.618** | **0.656** |

残課題:

- muko-clip2 が最弱。FP が多く、recall も低い。
- fukui は短ラリーの no-overlap FN が残る。
- clip1 は比較的良いが、追加候補に弱く FP が増えやすい。

---

## Iter 1: scoreless window reranker

追加:

- `scripts/eval/scoreless-window-rerank.py`

手法:

- 複数の visual activity 閾値で高 recall candidate を生成。
- window duration、activity density、blob/motion統計を特徴量化。
- `HistGradientBoostingClassifier` を leave-one-clip-out で学習。
- score ROI / score event / score-state は入力に使わない。

run: `iter-scoreless-rerank1`

結果:

| clip | F1 |
|---|---:|
| `yt-maitou-suzumura-fukui-clip1` | 0.651 |
| `yt-maitou-suzumura-muko-clip1` | 0.333 |
| `yt-maitou-suzumura-muko-clip2` | 0.375 |
| **Aggregate** | **0.453** |

判定: **rejected**

理由:

- train fold F1 は高いが held-out clip で大幅後退。
- 既存 3 clip だけでは window classifier が clip 固有の見え方に過学習している。

---

## Iter 2: conservative augment reranker

手法:

- `iter-scoreless-refine1` の安定窓は削らない。
- reranker は base と重ならない未カバー候補の rescue だけに使う。
- `augment-max-base-iou` を厳しくし、既存窓周辺の重複FPを抑える。

run: `iter-scoreless-augment1`

| clip | F1 |
|---|---:|
| `yt-maitou-suzumura-fukui-clip1` | 0.708 |
| `yt-maitou-suzumura-muko-clip1` | 0.625 |
| `yt-maitou-suzumura-muko-clip2` | 0.485 |
| **Aggregate** | **0.606** |

判定: **rejected**

run: `iter-scoreless-augment2`

| clip | F1 |
|---|---:|
| `yt-maitou-suzumura-fukui-clip1` | 0.708 |
| `yt-maitou-suzumura-muko-clip1` | 0.727 |
| `yt-maitou-suzumura-muko-clip2` | 0.444 |
| **Aggregate** | **0.627** |

判定: **rejected**

理由:

- fukui と muko-clip2 は一部改善するが、clip1 の FP 増加を相殺できない。
- aggregate は current best `0.634` に届かない。

---

## Iter 3: TrackNet gate 再評価

目的:

- TrackNet V1 confidence が scoreless pipeline の perception feature として使えるか確認する。
- 過去の `iter-tracknet-gate1` は clip1 の粗い stride のみで、`confidenceAdjustedAuc=0.566` と弱かった。

実行方針:

```bash
/usr/local/bin/python3.11 scripts/eval/tracknet-gate.py \
  --run-id iter-tracknet-gate2 \
  --download-weights \
  --stride 60 \
  --max-triplets 180 \
  --device cpu
```

判定基準:

- 全clipの confidence adjusted AUC が `>=0.65` なら、reranker feature に統合する。
- 未達なら、TrackNet V1 は今回の fixed-camera scoreless には不採用。

結果: `iter-tracknet-gate2-lite`

| clip | confidenceAdjustedAuc | windowOracle F1 |
|---|---:|---:|
| `yt-maitou-suzumura-fukui-clip1` | 0.520 | 0.000 |
| `yt-maitou-suzumura-muko-clip1` | 0.529 | 0.000 |
| `yt-maitou-suzumura-muko-clip2` | 0.597 | 0.000 |

判定: **rejected**

理由:

- いずれの clip も AUC `0.65` に届かない。
- visible window oracle も F1 `0.000`。
- CPU 推論は重く、`stride=60, maxTriplets=180` は長時間化したため中断。`stride=180, maxTriplets=30` の lite gate で分離性だけ確認した。
- TrackNet V1 confidence は今回の fixed-camera scoreless reranker feature として採用しない。

---

## 現時点の結論

現データ 3 clip だけでF1 0.85へ到達する見込みは低い。今回の追加 iteration では best は引き続き `iter-scoreless-refine1` の F1 `0.634`。

理由:

1. window classifier は3clip LOCOで過学習し、held-out clipで崩れる。
2. muko-clip2 は映像activityだけでは no-overlap FN と no-overlap FP の分離が難しい。
3. scoreありrunでも 0.741 であり、scoreless 0.85 には perception 追加とデータ拡張が必要。

次に進むべき作業:

1. `fixed-camera-v2` に候補動画を 5 clip 追加し、独立ラベルを作る。
2. TrackNet gate が不採用なら、TrackNetV4 / motion attention 系へ進む。
3. reranker は expanded dataset ができるまで production へ移植しない。

今回の停止理由:

- `iter-scoreless-rerank1`、`iter-scoreless-augment1`、`iter-scoreless-augment2` はすべて current best を下回った。
- TrackNet V1 gate は AUC 不足で不採用。
- 目標 `0.85` までは、追加データの独立ラベルと、TrackNetV4 などのより強い ball/motion perception が必要。

---

## Iter 4: fixed-camera-v2 scaffold と再現 smoke

追加:

- `eval/datasets/fixed-camera-v2/README.md`
- `eval/datasets/fixed-camera-v2/candidates.json`
- `eval/datasets/fixed-camera-v2/labels/*`
- `scripts/eval/scoreless-rally-refine.py --dataset`
- `scripts/eval/scoreless-window-rerank.py` から refine module への dataset 伝播
- `scripts/eval/scoreless-rally-refine.py --allow-refined-base` guard

目的:

- `fixed-camera-v1` の3clipを seed として `fixed-camera-v2` 評価パイプラインを作る。
- raw video / frames / results は git 管理せず、labels と候補metadataだけを管理する。
- 新規clipの独立ラベル追加後に、scoreless method を LOCO / holdout で検証できる状態にする。

Web / 論文再調査:

- TrackNet: https://arxiv.org/abs/1907.03698
  - 高速・小物体の heatmap tracking。既存 TrackNet V1 gate は今回の fixed-camera では AUC 不足。
- TrackNetV4: https://arxiv.org/abs/2409.14543
  - frame differencing と motion attention を TrackNet 系に組み込む。現在の scoreless visual activity failure と方向性が合う。
- TOTNet: https://arxiv.org/abs/2508.09650
  - occlusion-aware temporal tracking。open weights / runtime が実用的なら次候補。

v2 seed baseline:

```bash
/usr/local/bin/python3.11 scripts/eval/scoreless-rally-refine.py \
  --dataset fixed-camera-v2 \
  --run-id iter-v2-scoreless-refine-seed \
  --base-run-id iter-fc6-3clip

npm run eval:score -- \
  --run-id iter-v2-scoreless-refine-seed \
  --dataset fixed-camera-v2 \
  --baseline-run-id iter-scoreless-refine1
```

結果:

| clip | F1 | P | R |
|---|---:|---:|---:|
| `yt-maitou-suzumura-fukui-clip1` | 0.696 | 0.727 | 0.667 |
| `yt-maitou-suzumura-muko-clip1` | 0.769 | 0.714 | 0.833 |
| `yt-maitou-suzumura-muko-clip2` | 0.437 | 0.412 | 0.467 |
| **Aggregate** | **0.634** | **0.618** | **0.656** |

判定: **reproduced**

補足:

- `iter-scoreless-refine1` をさらに refine した smoke (`iter-v2-scoreless-refine1`) は aggregate F1 `0.601` に低下。
- これは dataset 問題ではなく、post-refinement を二重適用したことによる過trim。baseline としては採用しない。
- 同じ誤操作を避けるため、refine 済み run を base にした二重 refine は明示的な `--allow-refined-base` なしでは停止するようにした。

v2 reranker smoke:

```bash
/usr/local/bin/python3.11 scripts/eval/scoreless-window-rerank.py \
  --dataset fixed-camera-v2 \
  --run-id iter-v2-scoreless-rerank-smoke \
  --base-run-id iter-v2-scoreless-refine-seed

npm run eval:score -- \
  --run-id iter-v2-scoreless-rerank-smoke \
  --dataset fixed-camera-v2 \
  --baseline-run-id iter-v2-scoreless-refine-seed
```

結果:

| clip | F1 | P | R |
|---|---:|---:|---:|
| `yt-maitou-suzumura-fukui-clip1` | 0.708 | 0.708 | 0.708 |
| `yt-maitou-suzumura-muko-clip1` | 0.625 | 0.500 | 0.833 |
| `yt-maitou-suzumura-muko-clip2` | 0.485 | 0.444 | 0.533 |
| **Aggregate** | **0.606** | **0.551** | **0.692** |

判定: **rejected**

理由:

- fukui と muko-clip2 の recall は一部改善するが、muko-clip1 の FP が増えて aggregate は `0.634` を下回る。
- `analyze-errors.py` の next hypothesis は引き続き `yt-maitou-suzumura-muko-clip2` の precision 改善。
- 3clip seed だけでは reranker が clip 固有差に過学習しやすい。

現時点の採用方針:

- current best は `iter-scoreless-refine1` / `iter-v2-scoreless-refine-seed` の aggregate F1 `0.634`。
- `scoreless-window-rerank.py` は研究用に残すが、production には採用しない。
- 次の精度改善 iteration は、新規候補動画の独立ラベルを `fixed-camera-v2` に追加してから実施する。ラベル無しで目標 F1 `0.85` 到達を主張しない。
