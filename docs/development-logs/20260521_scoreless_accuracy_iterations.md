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

---

## Iter 5: v2 asset tooling と lightweight motion-attention gate

追加:

- `scripts/eval/prepare-fixed-camera-assets.py --dataset`
- `scripts/eval/prepare-fixed-camera-assets.py --scan-fps / --track-fps`
- `scripts/eval/prepare-fixed-camera-assets.py --include-candidate-clips`
- `scripts/eval/motion-attention-gate.py`
- `eval/datasets/**/motion-tracks/` を git ignore

目的:

- `fixed-camera-v2` の label / candidate metadata から、動画取得、clip切り出し、3fps scan frames、30fps tracking frames を同じスクリプトで作れるようにする。
- TrackNetV4 の完全再現に入る前に、frame differencing と小さな高速blobを使った軽量 motion-attention proxy の分離力を確認する。
- score / OCR / scoreboard / score-state は引き続き使わない。

v2候補の優先順位:

| priority | id | title |
|---:|---|---|
| 1 | `aIAx_p6LlFo` | USTA 4.5 Baseliner vs. USTA 4.0 Pusher |
| 2 | `29hnQXTyUzM` | USTA 4.5 Baseliner vs USTA 4.5 Big Hitter |
| 3 | `Na9S4gJzel0` | テニステップ 男子シングルス大会 西大宮テニスクラブ |

実行:

```bash
/usr/local/bin/python3.11 scripts/eval/motion-attention-gate.py \
  --dataset fixed-camera-v2 \
  --run-id iter-motion-attention-gate1 \
  --sample-fps 6 \
  --max-samples 2400
```

結果:

| clip | confidence adjusted AUC | window oracle F1 |
|---|---:|---:|
| `yt-maitou-suzumura-fukui-clip1` | 0.516 | 0.000 |
| `yt-maitou-suzumura-muko-clip1` | 0.517 | 0.000 |
| `yt-maitou-suzumura-muko-clip2` | 0.523 | 0.000 |

判定: **rejected**

理由:

- 採用基準の adjusted AUC `0.65` に届かない。
- window oracle F1 も `0.000` で、現時点では rally reranker の feature に入れる価値がない。
- 単純な「小さく速いblob」だけでは、ノイズ、選手動作、ボール拾い、サーブ準備とラリー中のボールを十分に分離できない。

次の判断:

- current best は引き続き `iter-scoreless-refine1` / `iter-v2-scoreless-refine-seed` の aggregate F1 `0.634`。
- `motion-attention-gate.py` は研究用 gate として残すが、production へ統合しない。
- 精度改善の次手は、`fixed-camera-v2` の新規独立ラベル追加を優先する。ラベル追加後に、TrackNetV4 / TOTNet 系の実モデル導入または fine-tuning を評価する。

---

## Iter 6: ローカル限定 9clip 化に向けた実装基盤

追加:

- `scripts/eval/validate-rally-labels.py`
- `scripts/eval/screen-fixed-camera-candidates.py`
- `scripts/eval/label-audit-report.py`
- `scripts/eval/pose-extract.py --dataset`
- `scripts/eval/pose-gate.py --dataset`
- `scripts/eval/scoreless-window-rerank-v2.py`
- `eval/datasets/**/screening/` を git ignore

目的:

- `fixed-camera-v2` を seed 3clip から 9clip へ拡張する前提で、候補確認、ラベル検証、ラベル監査、pose/motion/visual特徴の評価経路を整備する。
- ローカルCPU限定のため、TrackNetV4/TOTNetのfine-tuningではなく、まずは公開重み/軽量特徴/HistGradientBoosting の範囲で評価する。
- ラベル無しでF1 `0.85` 到達を主張しない。新規独立ラベルを追加してから expanded v2 leaderboard を固定する。

検証:

```bash
/usr/local/bin/python3.11 scripts/eval/validate-rally-labels.py \
  --dataset fixed-camera-v2

/usr/local/bin/python3.11 scripts/eval/screen-fixed-camera-candidates.py \
  --dataset fixed-camera-v2 \
  --dry-run \
  --candidate-id aIAx_p6LlFo

/usr/local/bin/python3.11 scripts/eval/pose-gate.py \
  --dataset fixed-camera-v2 \
  --run-id iter-pose-gate-v2-seed

/usr/local/bin/python3.11 scripts/eval/scoreless-window-rerank-v2.py \
  --dataset fixed-camera-v2 \
  --run-id iter-rerank-v2-seed \
  --base-run-id iter-v2-scoreless-refine-seed

npm run eval:score -- \
  --run-id iter-rerank-v2-seed \
  --dataset fixed-camera-v2 \
  --baseline-run-id iter-v2-scoreless-refine-seed
```

結果:

| run | aggregate F1 | P | R | 判定 |
|---|---:|---:|---:|---|
| `iter-v2-scoreless-refine-seed` | 0.634 | 0.618 | 0.656 | current best |
| `iter-rerank-v2-seed` | 0.590 | 0.542 | 0.656 | rejected |

clip別:

| clip | baseline F1 | rerank-v2 F1 |
|---|---:|---:|
| `yt-maitou-suzumura-fukui-clip1` | 0.696 | 0.667 |
| `yt-maitou-suzumura-muko-clip1` | 0.769 | 0.714 |
| `yt-maitou-suzumura-muko-clip2` | 0.437 | 0.389 |

判定: **rejected**

理由:

- motion feature は `iter-motion-attention-gate1` で既にAUC不足。
- v2 seedにはpose TSVがまだなく、rerank-v2は実質 visual + weak motion のみ。
- 3clip seed のままではモデルがclip固有差に過学習し、全clipでbaselineを下回った。

次の必須作業:

1. `screen-fixed-camera-candidates.py` で6候補のpreview/contact sheetを作る。
2. 各候補から固定カメラ区間を1つ選び、`candidates.json` に `selectedClips` を追加する。
3. `prepare-fixed-camera-assets.py --dataset fixed-camera-v2 --include-candidate-clips` でframesを作る。
4. 手作業で独立ラベルを作り、`validate-rally-labels.py` を通す。
5. 9clipで baseline / pose gate / rerank-v2 を再評価する。

現時点の採用方針:

- production採用は引き続き `iter-scoreless-refine1` 相当。
- `scoreless-window-rerank-v2.py` は expanded v2 で再評価するまで研究用。
- ローカル限定でF1 `0.85` に届かない場合は、GPU fine-tuning が必要な段階として扱う。

---

## Iter 7: fixed-camera-v2 候補6本のスクリーニング完了

目的:

- seed 3clip のまま特徴量を重ねても過学習しやすいため、まず新規6clip候補の固定カメラ区間を確定する。
- ラベルを捏造せず、preview/contact sheetで確認できた区間だけを `selectedClips` として登録する。
- 9clip評価へ進むための入力素材を作る。F1改善は、手動ラベル作成後に初めて評価する。

実行:

```bash
/usr/local/bin/python3.11 scripts/eval/screen-fixed-camera-candidates.py \
  --dataset fixed-camera-v2 \
  --max-height 480 \
  --preview-duration-sec 900 \
  --sheet-interval-sec 30
```

生成物:

- `eval/datasets/fixed-camera-v2/screening/*-contact-0s.jpg`
- `eval/datasets/fixed-camera-v2/screening/*-preview-0s.mp4`
- `eval/datasets/fixed-camera-v2/videos/source-*.mp4`

上記は `.gitignore` 配下のローカル確認用ファイルで、Gitには含めない。

選定結果:

| priority | clipId | source | offset | duration | 判定 |
|---:|---|---|---:|---:|---|
| 1 | `yt-61l1sw26dtg-clip1` | `61L1sW26dtg` | 0 | 900 | fixed full-court, best new label candidate |
| 2 | `yt-29hnqxtyuzm-clip1` | `29hnQXTyUzM` | 30 | 870 | fixed full-court, hard shadows and score overlay |
| 3 | `yt-na9s4gjzel0-clip1` | `Na9S4gJzel0` | 0 | 900 | fixed wide view, adjacent courts/background motion |
| 4 | `yt-wuywqtrg4rw-clip1` | `WuywQtrG4Rw` | 270 | 510 | middle fixed section only |
| 5 | `yt-aiax-p6llfo-clip1` | `aIAx_p6LlFo` | 90 | 630 | middle fixed section only, glare/cuts present |
| 6 | `yt-fqk-endhdno-clip1` | `-FQkEndhdNo` | 0 | 900 | fixed full-court but severe fence occlusion; hard case |

追加実装:

- `screen-fixed-camera-candidates.py` に `--start-sec`, `--sheet-cols`, `--sheet-rows` を追加済み。
- contact sheet / preview のファイル名に start秒を含めた。
- contact sheet生成に `ffmpeg -update 1` を追加し、単一JPEG出力の警告を抑制した。

判定:

- `fixed-camera-v2` は seed 3clip + candidate 6clip の 9clip化に進める状態になった。
- まだ新規clipのrallyラベルは存在しないため、aggregate F1は更新しない。
- 次に必要なのは、各 `selectedClips` の手動ラベル作成、`validate-rally-labels.py --dataset fixed-camera-v2`、その後の baseline / pose gate / rerank-v2 再評価。

次の評価順:

1. 優先度1から5までを先に手動ラベル化し、最低8clip評価を作る。
2. 優先度6のフェンス越しclipは hard-case holdout として最後に加える。
3. expanded評価で `iter-v2-scoreless-refine-seed` を再実行し、clip別の失敗要因を確認する。
4. それでもF1が伸びない場合は、TrackNetV4/TOTNet系のボール追跡モデルをローカル推論またはGPU fine-tuning候補として切り分ける。

---

## Iter 8: fixed-camera-v2 expanded 8clip F1更新と scoreless grid tuning

目的:

- 優先度1-5の新規 fixed-camera clip を手動ラベル化し、seed 3clip + new 5clip の 8clip 評価へ拡張する。
- hard-case の `yt-fqk-endhdno-clip1` はフェンス遮蔽が強いため、今回の main 評価からは除外し holdout 候補に残す。
- TrackNetV4 / TOTNet 系のボール追跡モデルは引き続き候補だが、今回は追加weightなしで再現できる scoreless motion/blob feature の parameter tuning を先に実施する。
  - TrackNetV4: https://arxiv.org/abs/2409.14543
  - TOTNet: https://arxiv.org/abs/2508.09650

実装:

- `prepare-fixed-camera-assets.py`
  - `--skip-track-frames` を追加し、3fps scan frames だけを作れるようにした。
  - clip が既に存在する場合は source video の再DLを避けるようにした。
- `run-stage1.ts`
  - legacy 30fps frames を `--fps 3` の timeline へ均一サンプルする処理を追加した。
  - decode concurrency を制限し、`EMFILE: too many open files` を回避した。
  - rally segmentation の閾値・padding・split条件を CLI から渡せるようにした。
- `rallySegment.ts`
  - blob threshold、bridge threshold、window padding、refine padding、split quiet gap などを `RallySegmentOptions` 化した。
  - default 値は既存挙動と同じにして、production default は変更していない。
- `tune-scoreless-stage1.ts`
  - 各clipを一度だけfeature化し、複数configを比較する scoreless grid tuning script を追加した。
  - LOCO selection、global aggregates、per-config F1、baseline差分、regression summary を manifest に記録する。

手動ラベル:

新規5clipは、3秒間隔の contact sheet を目視確認し、タイトル・会話・移動だけの時間を除外して rally boundary を作成した。検出結果やscore出力は使っていない。

| clip | rallies | note |
|---|---:|---|
| `yt-61l1sw26dtg-clip1` | 26 | clean fixed full-court |
| `yt-29hnqxtyuzm-clip1` | 26 | hard shadows + scoreboard overlay |
| `yt-na9s4gjzel0-clip1` | 25 | adjacent-court background motion |
| `yt-wuywqtrg4rw-clip1` | 15 | middle fixed match section |
| `yt-aiax-p6llfo-clip1` | 16 | glare/cuts present |

検証コマンド:

```bash
/usr/local/bin/python3.11 scripts/eval/validate-rally-labels.py \
  --dataset fixed-camera-v2

npm run eval:run1 -- \
  --dataset fixed-camera-v2 \
  --run-id iter-v2-expanded-blob1 \
  --fps 3 \
  --detector blob

npm run eval:score -- \
  --run-id iter-v2-expanded-blob1 \
  --dataset fixed-camera-v2

npx tsx scripts/eval/tune-scoreless-stage1.ts \
  --dataset fixed-camera-v2 \
  --run-id iter-v2-expanded-loco-tune2 \
  --fps 3 \
  --baseline-run-id iter-v2-expanded-blob1

npm run eval:score -- \
  --run-id iter-v2-expanded-loco-tune2 \
  --dataset fixed-camera-v2 \
  --baseline-run-id iter-v2-expanded-blob1
```

結果:

| run | aggregate F1 | P | R | 判定 |
|---|---:|---:|---:|---|
| `iter-v2-expanded-blob1` | 0.433 | 0.424 | 0.451 | expanded baseline |
| `iter-v2-expanded-refine1` | 0.419 | 0.411 | 0.435 | rejected |
| `iter-v2-expanded-tight-gap-long1` | 0.459 | 0.467 | 0.456 | rejected |
| `iter-v2-expanded-tight-refine1` | 0.464 | 0.475 | 0.458 | rejected |
| `iter-v2-expanded-loco-tune2` | 0.487 | 0.507 | 0.476 | rejected by regression guard |

best experimental は `split-sensitive` / LOCO の F1 `0.487` で、expanded baseline から `+0.054` 改善した。ただし regression guard は rejected。

主な clip 別変化:

| clip | baseline F1 | best experimental F1 | delta |
|---|---:|---:|---:|
| `yt-61l1sw26dtg-clip1` | 0.367 | 0.571 | +0.205 |
| `yt-wuywqtrg4rw-clip1` | 0.353 | 0.563 | +0.210 |
| `yt-aiax-p6llfo-clip1` | 0.500 | 0.625 | +0.125 |
| `yt-maitou-suzumura-fukui-clip1` | 0.652 | 0.545 | -0.107 |
| `yt-maitou-suzumura-muko-clip2` | 0.437 | 0.258 | -0.179 |

判定:

- expanded F1 は更新できたが、採用gate（aggregate +0.02 かつ clip regression < -0.05 なし）は未達。
- `split-sensitive` は屋外一般ユーザーclipでは効く一方、既存seedの soft-tennis / indoor clip で落ちる。
- production default は変更しない。今回の成果は「評価拡張」「再現可能なtuning基盤」「experimental F1上限の更新」として扱う。

次の改善仮説:

1. seed と新規clipで最適閾値が分かれており、単一の blob threshold では限界がある。court/backgroundの状態に応じた adaptive threshold が必要。
2. 3秒 contact sheet ラベルは初回ラベルとしては有効だが、F1 0.85 を目指すには boundary の再確認が必要。特に新規5clipは 1-2秒単位の追加reviewを行う。
3. scoreless motion/blob だけでは adjacent-court / shadow / glare を分離しきれないため、次段は TrackNetV4/TOTNet 系の ball trajectory を検証対象にする。
