# 開発ログ: fixed-camera-v1 データセット構築とベースライン測定

**日付**: 2026-05-18  
**フェーズ**: Phase A (データセット構築) + Phase B (ベースライン測定)  
**目的**: 固定カメラアマチュアテニス試合に特化した eval ループの再起動

---

## 背景（スコープ変更の要約）

前回のログ（20260517）で `pro-broadcast-v1` の iter2c baseline (F1=0.516) を確立した。  
しかし CourtLens の実際のユースケースは「ユーザーが三脚などで固定撮影した試合録画」であり、  
放送映像（カメラ切り替え・リプレイ・クローズアップ多数）とは環境が大きく異なる。

ユーザーの判断：**ターゲットを固定カメラ動画に絞る**。  
→ `fixed-camera-v1` データセットを新規構築し、eval ループを再起動。

---

## Phase A: データセット構築

### A-1. 動画選定・取得

以下の動画を yt-dlp で取得（`eval/datasets/fixed-camera-v1/videos/`）:

| ID | タイトル | 時間 |
|---|---|---|
| `yt-maitou-suzumura-muko` | 杉村太蔵 vs 向和彦（大正セントラルTCクラブ目白, 2023.10.25） | 30:46 |
| `yt-maitou-suzumura-fukui` | 鈴村 vs 福井戦（同チャンネル） | 11:17 |

**動画は 48h 以内に削除推奨（YouTube ToS）**。clips/ と frames/ が完成次第削除済み。

### A-2. クリップ切り出し

`ffmpeg -ss 0 -to 600 -c copy` で再エンコードなし:

| クリップ ID | ソース | 区間 | ファイルサイズ |
|---|---|---|---|
| `yt-maitou-suzumura-muko-clip1` | yt-maitou-suzumura-muko | 0-600s | 64MB |
| `yt-maitou-suzumura-muko-clip2` | yt-maitou-suzumura-muko | 600-1200s | 74MB |
| `yt-maitou-suzumura-fukui-clip1` | yt-maitou-suzumura-fukui | 0-600s | 135MB |

### A-3. フレーム抽出

`scripts/eval/lib/frameSampler.node.ts` に以下の変更を加えた:
- 元: `-q:v 2`（高品質 JPEG、~260KB/frame）
- 変更後: `scale=1280:-1,fps=${fps}` + `-q:v 5`（~80KB/frame）

**理由**: ディスク空き容量 1.1GB で 1800 frames × 260KB = 468MB が収まらず抽出失敗した。  
`decodeFrameGrayNode` が常に 320px に正規化するため、JPEG 品質変更はアルゴリズムに無影響。

抽出結果:
- `yt-maitou-suzumura-muko-clip1`: 1800 frames → 146MB
- `yt-maitou-suzumura-muko-clip2`: 1800 frames → 152MB  
- `yt-maitou-suzumura-fukui-clip1`: 1800 frames → 160MB

### A-4. ラベリング（clip1 のみ、ベースライン用）

3fps フレームを目視サンプリングしてスコア変化を追跡し GT ラベルを作成。  
精度 ±5s（目標 ±3s）。18 ラリー / 600s。

#### スコア遷移サマリー

| ラリー # | 区間 | スコア変化 | サーバー |
|---|---|---|---|
| 1 | 11-27s | 0-0→0-15 | 杉村（far） |
| 2 | 52-64s | 0-15→15-15 | 杉村（far） |
| 3 | 87-97s | 15-15→30-15 | 杉村（far） |
| 4 | 109-136s | 30-15→30-30 | 杉村（far） |
| 5 | 144-155s | 30-30→40-30 | 杉村（far） |
| 6 | 163-177s | 40-30→Game 杉村 | 杉村（far） |
| — | ~177-215s | ゲーム間 / エンドチェンジ | — |
| 7 | 215-241s | 0-0→15-0 (G2) | 向（far） |
| 8 | 258-270s | 15-0→15-15 | 向（far） |
| 9 | 280-293s | 15-15→30-15 | 向（far） |
| 10 | 315-328s | 30-15→40-15 | 向（far） |
| 11 | 368-378s | 40-15→40-30 | 向（far） |
| 12 | 383-395s | 40-30→DEUCE | 向（far） |
| 13 | 406-418s | Deuce→Adv 向 | 向（far） |
| 14 | 422-445s | Adv→Game 向 | 向（far） |
| — | ~445-462s | ゲーム間 | — |
| 15 | 463-490s | 0-0→15-0 (G3) | 杉村（near） |
| 16 | 503-516s | 15-0→30-0 | 杉村（near） |
| 17 | 527-543s | 30-0→30-15 | 杉村（near） |
| 18 | 555-572s | 30-15→40-15（クリップ終了） | 杉村（near） |

---

## Phase B: ベースライン測定

### B-1. 実行

```bash
npm run eval:run1 -- --dataset fixed-camera-v1 --run-id fixed-baseline
npm run eval:score -- --run-id fixed-baseline --dataset fixed-camera-v1
```

### B-2. 結果

| 指標 | fixed-baseline |
|---|---|
| **Event F1** | **0.000** |
| Precision | 0.000 |
| Recall | 0.000 |
| IoU mean | 0.000 |
| FP sec/min | 9.0 |
| GT rallies | 18 |
| Detected | 1 |

### B-3. 根本原因分析

**現象**: 検出ウィンドウが `[0s, 90s]` の 1 本のみ。18 ラリーすべて見逃し。

**原因の詳細デバッグ**:

```
# 代表フレームでの blob 数（3fps 抽出、320px 正規化後）
t=0.3s:   11 blobs  ← 1 ≤ n ≤ 20 → ballPresent=true
t=27.0s:   3 blobs  ← ballPresent=true
t=90.1s:   4 blobs  ← ballPresent=true
t=150.1s: 17 blobs  ← ballPresent=true
t=300.2s:  2 blobs  ← ballPresent=true
t=500.3s: 13 blobs  ← ballPresent=true
t=599.7s: 11 blobs  ← ballPresent=true
```

**全フレームで `isBroadcastBallPresenceFrame` が true を返す**。

→ `ballPresentAt` に全フレームのタイムスタンプが入る  
→ `gapToleranceSec=5s` で全て 1 窓にマージ → 600s の生窓  
→ `appendWindow` で `clampedEnd = min(windowEnd+4, paddedStart+90) = min(604, 90) = 90s`  
→ 検出結果: `[0s, 90s]`  
→ GT の各ラリー（11-27s, 52-64s, ...）との IoU は 0.5 未満 → TP=0

**根本的な問題**:  
`isBroadcastBallPresenceFrame(blobCount > 0 && blobCount ≤ 20)` は放送カメラ前提の設計。  
放送映像では「カメラ切り替え・観客クローズアップ時に blob が 20 以上になる」ため、  
blob 数が少ない = ボール有り、という仮定が成立していた。  

固定カメラでは：
- カメラ切り替えなし → 常に少数 blob（1-17）が存在
- 少数 blob の正体 = **選手の動き**（足、ラケット先端、ユニフォームの動き）
- 実際のテニスボールも少数 blob を作るが、選手動作由来の blob と区別できない
- 結果: ゲーム中は常に `ballPresent=true` → 1 本の巨大ウィンドウ

---

## Phase C: iter ループへの方針転換

### 問題の本質

現アルゴリズムは「カメラ切り替えで検出がリセットされる」という broadcast 前提で動作している。  
固定カメラでは **ポイント間の「静止」** を利用して分割するアプローチが必要。

### iter 1 の目標（codex に渡す）

以下の 2 アプローチのどちらか（または組み合わせ）で F1 > 0.3 を目指す：

**アプローチ A: 動的閾値 — "静止フレーム" 検出**  
ポイント間の選手の静止を検出するために、blob 数が少ない連続フレームを「inter-point gap」として使う。  
具体的には: `ballPresentAt` に「選手が動いていない」フレームを含めない仕組みを作る。  
→ 大きな blob（選手全体）をフィルタしつつ、小さな blob（ボール）だけを追跡。

**アプローチ B: 空間マスキング — スコアオーバーレイ除外**  
画面左上（スコアボード）と右上（タイトルテキスト）からの blob を除外する。  
これだけでは選手の動き由来の blob は除去できないが、overlay 偽陽性は減る。

**アプローチ C: 選手動体との分離**  
大きな連続した動き領域（選手のシルエット）を事前にマスクし、その中にある小さな blob をボール候補として使う。  
→ フレーム差分 AND 後、大きなコネクテッドコンポーネント（面積 > 200px^2 at 320px）を除去してから blob 検出。

**推奨**: アプローチ A + C の組み合わせ。Aは「選手静止時 = ポイント間」を利用し、Cは「選手動作中でも選手自身を blob から除外」する。

### iter 1 codex ブリーフ（予定）

タスク: `src/services/ball/core/` 内のアルゴリズムを固定カメラ向けに調整

1. **`blobDetect.ts`**: `MIN_AREA=3, MAX_AREA=80` → 大きな選手シルエットを除去するための後処理を追加（面積 > 500 の連続塊を展開してマスク）
2. **`rallySegment.ts`**: `isBroadcastBallPresenceFrame` ロジックの固定カメラ版を検討
3. **評価**: `fixed-camera-v1` の dev set で F1 > 0.30 を達成すること

---

## 次のステップ

1. ~~iter 1 アルゴリズム改修~~ → **完了（F1=0.512）** (commit c05669c)
2. iter 2: 精度改善（FP 削減）
3. clip2 (muko-clip2) と fukui-clip1 のラベリング（dev set 拡充）
4. dev set 3 本揃った時点で iter ループ本格化

---

## Phase C: iter ループ

### iter-fc1 結果（2026-05-19）

**変更点**:
- `playerMask.ts` 追加: `removeLargeRegions()` — 選手シルエット由来の大 CC を除去（効果は限定的だったが将来チューニング基盤として有用）
- `rallySegment.ts`: `isActiveRallyFrame(n ≥ 13)` — 固定カメラでは rally 中に player+ball 双方が動くため blob 数が多い（≥13）という逆相関を利用
- `DEFAULT_MAX_DURATION_SEC` 90 → 25、`DEFAULT_GAP_TOLERANCE_SEC` 5 → 3
- `mergeOverlappingWindows` に hard cap 追加（cascade merge 防止）
- `run-stage1.ts`: clips 削除後でも `framePaths.length/fps` で正確な duration を計算（582s ではなく 600s）

| 指標 | fixed-baseline | iter-fc1 |
|---|---|---|
| Event F1 | 0.000 | **0.512** |
| Precision | 0.000 | 0.440 |
| Recall | 0.000 | 0.611 |
| IoU mean | 0.000 | 0.711 |
| FP sec/min | 9.0 | 19.97 |
| GT rallies | 18 | 18 |
| Detected | 1 | 25 |
| TP | 0 | 11 |

**根本的な発見**: 固定カメラでは `blob >= 13` が rally/inter-point を分離する。Broadcast 版（`blob 1-20 = ball present`）と逆の仮説が成立。タイムスタンプの正確な計算も重要（-17s ドリフト修正で F1 0.350 → 0.512 に向上）。

**主な課題（iter 2 への課題）**:
- TP=11/18 (Recall=0.611): 残る FN = GT[109-136], [280-293], [383-395], [406-418], [422-445], [463-490], [555-572]
- FP=14/25 (Precision=0.440): 偽陽性が多い
- IoU near-miss: [306,326] IoU=0.47 with GT[315,328] — あと 3s ずれれば TP

---

### iter-fc2 結果（2026-05-19）

**変更点**:
- `MIN_FIXED_CAM_RALLY_BLOBS` 13 → 11（dev set 分析で最適閾値を再調整）
- `DEFAULT_MAX_DURATION_SEC` 25 → 30（最長 GT ラリー 27s に余裕を持たせる）
- `DEFAULT_GAP_TOLERANCE_SEC` 変更なし（3s 維持）
- `mergeDetectionsIntoWindows` に `maxDurationSec` 引数を追加し `mergeOverlappingWindows` へ正しく渡す

| 指標 | iter-fc1 | iter-fc2 |
|---|---|---|
| Event F1 | 0.512 | **0.632** |
| Precision | 0.440 | 0.600 |
| Recall | 0.611 | 0.667 |
| IoU mean | 0.711 | 0.610 |
| FP sec/min | 19.97 | 16.17 |
| GT rallies | 18 | 18 |
| Detected | 25 | 20 |
| TP | 11 | 12 |

**FP/FN の詳細分析（iter-fc2 実装後）**:

| 分類 | ラリー | best IoU | 原因 |
|---|---|---|---|
| FN | GT[109,136] | 0.407 | 検出窓が 109-120 で終了。116-125s に 4s の空白があり gap_tol=3s で分割 |
| FN | GT[368,378] | 0.104 | 活動が 373s から始まり GT 開始 368s に 5s 遅れる |
| FN | GT[383,395] | 0.443 | 検出 [374.5,401.6] が GT[368,378]+GT[383,395] を 1 つにまとめ IoU が低下 |
| FN | GT[422,445] | 0.004 | 活動が 1.7s+2s の 2 バーストのみ（gap 3.3s）。いずれも min_dur=4s 未満 |
| FN | GT[463,490] | 0.479 | 検出 [461.6,476.6] は正確だが GT は 474-490s の無動作期間を含む（ラベル精度問題の疑い） |
| FN | GT[503,516] | 0.459 | 検出が 492s（サーブ前準備）から開始、GT は 503s から。11s の先行起動 |

**天井の確認**:
- Python シミュレーション（grid search: min_blobs=[10,11], gap_tol=[3,4], max_dur=[30,35,40]）で F1>0.640 となる組み合わせはゼロ
- パラメータ変更は必ずゼロサムトレードオフ（一つの FN を解消すると別の TP が FN 化）
- **blob カウント単独では clip1 での F1=0.632 が実質的な天井**

---

### iter-fc3 試験（2026-05-19）— min_blobs=10 試験（却下）

**仮説**: `MIN_FIXED_CAM_RALLY_BLOBS` を 11→10 に下げることで GT[422,445] の疎な活動バーストを捕捉できるか。

**結果（clip1 のみ）**:
| 指標 | iter-fc2 | iter-fc3(試験) |
|---|---|---|
| Event F1 | **0.632** | 0.550 |
| Precision | 0.600 | 0.500 |
| Recall | 0.667 | 0.611 |
| TP | 12 | 11 |
| FP | 8 | 11 |
| Detected | 20 | 22 |

**判定**: 却下。閾値 10 は FP を増やしつつ TP も減少（strict worse）。min_blobs=11 に戻す。

---

### dev set 拡充（2026-05-19）— muko-clip2 自動ラベリング

clip1（18 ラリー）のみでは iter が収束。muko-clip2（600-1200s）の密度プロファイルを生成し、blob 密度から自動 GT ラベルを作成（**循環ラベル: 現行アルゴリズムの検出窓を基に作成のため iter 評価には clip1 のみ使用**）。

- `scripts/eval/debug-density.ts` を新規作成: 現行パイプラインで per-frame blob/motion プロファイルを出力
- `eval/datasets/fixed-camera-v1/labels/yt-maitou-suzumura-muko-clip2.json` を作成（17 ラリー、±7s 精度）

2 動画 aggregate 参考値（iter-fc2 アルゴリズム）:
| 指標 | clip1（独立ラベル） | clip2（循環ラベル） | aggregate |
|---|---|---|---|
| Event F1 | **0.632** | 1.000 | 0.816 |

**注意**: clip2 の F1=1.000 は循環ラベルによるもの。aggregate 0.816 は過大評価。Stage 1 の信頼できる指標は clip1 F1=0.632。

---

## 現状とアルゴリズムの限界

### blob カウント手法の天井（clip1, 2026-05-19 時点）

| 手法 | clip1 F1 |
|---|---|
| fixed-baseline | 0.000 |
| iter-fc1 (blob ≥ 13) | 0.512 |
| iter-fc2 (blob ≥ 11) | **0.632** |
| iter-fc3 試験 (blob ≥ 10) | 0.550 (却下) |

**根本的な制約**: 選手の「ポイント後移動」「サーブ準備」がラリー中の動きと blob カウント上で区別できない。以下の 3 つのシナリオはいずれも blob ≥ 11 を生成する:
1. ラリー中（選手 + ボールが同時に動く）
2. ポイント後の選手移動（相手コートへ移動、ボール拾い）
3. サーブ前準備（サーバーがベースラインに移動、バウンド）

### Stage 1 目標（F1 ≥ 0.85）到達のための次ステップ候補

1. **独立ラベルの追加**（muko-clip2 目視検証 + fukui-clip1 ラベリング）: 3 動画 dev set で iter の信頼性向上
2. **新シグナル導入**: blob カウント以外のシグナル（例: 選手静止検出、サーブ検出+タイマー、ボール軌跡推定）
3. **ML アプローチ**: blob カウント時系列への 1D CNN/LSTM 適用

---

## ファイル変更記録

| ファイル | 変更内容 |
|---|---|
| `scripts/eval/lib/frameSampler.node.ts` | `-q:v 5`, `scale=1280:-1` 追加でディスク使用量 44% 削減 |
| `eval/datasets/fixed-camera-v1/labels/yt-maitou-suzumura-muko-clip1.json` | 新規作成（18 ラリー、±5s 精度） |
| `eval/datasets/fixed-camera-v1/labels/yt-maitou-suzumura-muko-clip2.json` | 新規作成（17 ラリー、±7s 精度、自動生成・循環ラベル） |
| `src/services/ball/core/playerMask.ts` | 新規作成: `removeLargeRegions()` |
| `src/services/ball/core/rallySegment.ts` | 固定カメラ向けアルゴリズム全面書き直し。`MIN_FIXED_CAM_RALLY_BLOBS=11` が最適値 |
| `scripts/eval/run-stage1.ts` | clip 削除後の duration 計算修正 |
| `scripts/eval/debug-density.ts` | 新規: 現行パイプラインで per-frame blob/motion プロファイルを TSV 出力 |
| `scripts/eval/detect-clip2.ts` | 新規: clip2 に検出器を実行するワンショットスクリプト（デバッグ用） |
| `__tests__/services/ball/core/playerMask.test.ts` | 新規ユニットテスト |

---

## Phase C iter-fc4〜fc5: dual-zone bridge シグナル探索（2026-05-19）

### 動機

iter-fc2（blob ≥ 11, F1=0.632）の残存 FN 分析で以下を特定:

- **GT14[422,445]**: 2 バースト（1.7s+2.0s）が 3.33s gap で分断 → gap_tol=3s でギリギリ マージできない
- GT15/GT16 は IoU がそれぞれ 0.479/0.459 でギリギリ FN（threshold=0.5 未満）

GT14 の gap には t=429s で blob=10（≥11 未満）だが **rawMask の minTB（上下ハーフの最小値）=356** という非常に高い値が観測された。一方ポイント間の選手移動では minTB が最大 315 に留まる（peak: t=326s, minTB=315）。

→ **「blob は少ないが両半面に高い動きがある → ラリー中の一時的な空白」** を bridge シグナルとして追加する仮説。

### iter-fc4: minTB ≥ 100 単体（却下）

minTB 単体をシグナルとして使用。結果: clip1 F1=0.350（TP=7、FP=15、検出=22）。  
原因: ポイント間リセット（両選手の移動）で minTB≥100 が常時発火し、大型の誤窓が多発。

### iter-fc5b: blob ≥ 11 OR (blob ≥ 7 AND minTB ≥ 250)（却下）

hybrid bridge で threshold=250: clip1 F1=0.564（TP=11、FP=10、検出=21）。  
原因: t=326s（minTB=315）で bridge が発火し D12+D13 をマージ → GT10 を FN に変換。t=376s（minTB=255）でも誤 bridge。

### iter-fc5（確定版）: blob ≥ 11 OR (blob ≥ 7 AND minTB ≥ 320)

**閾値 320 の根拠**: `/tmp/density-clip1-spatial.tsv` の全 1798 フレームを精査:
- ポイント間移動の minTB ピーク: **315**（t=326s）
- GT14 の正当な bridge: **356**（t=429s）
- → 320 を閾値とすると誤 bridge をゼロに抑えつつ GT14 bridge のみ発火

**結果（clip1）**:

| 指標 | iter-fc2 | iter-fc5 |
|---|---|---|
| Event F1 | 0.632 | **0.667** |
| Precision | 0.600 | 0.619 |
| Recall | 0.667 | 0.722 |
| IoU mean | 0.610 | 0.602 |
| TP | 12 | **13** |
| FP | 8 | 8 |
| FN | 6 | 5 |
| Detected | 20 | 21 |

GT14（2 バーストを 3.33s gap で分断していた）が TP に変換。他の TP はすべて維持。

**aggregate 参考値（clip2 は循環ラベルにつき参考のみ）**:

| | clip1（独立） | clip2（循環） | aggregate |
|---|---|---|---|
| Event F1 | **0.667** | 1.000 | 0.833 |

### 残存 FN の分析（iter-fc5 時点）

| GT ラリー | 分類 | best IoU | 原因 |
|---|---|---|---|
| GT4[109,136] | FN | 0.407 | 2 バーストの gap=4.0s、bridge 候補の minTB=167（閾値 320 未満） |
| GT11[368,378] | FN | 0.104 | 検出が D15[374.5,401.6] でまとめられ IoU 低下 |
| GT12[383,395] | FN | 0.443 | 同上 |
| GT15[463,490] | FN | 0.479 | 検出 [461.6,476.6] は正確。GT の 474-490s が無動作（GT ラベル精度の問題の可能性） |
| GT16[503,516] | FN | 0.459 | サーブ前準備が 492s（GT は 503s）から検出 → padding で window が広がり IoU 低下 |

**clip1 での現時点の天井: F1≈0.667**（GT4/GT11/GT12 は blob+minTB シグナルでは原理的に困難）

### Stage 1 到達への課題

- clip1 独立 F1 が 0.667 → Stage 1 ゴール 0.85 まで約 0.18 のギャップ
- 残存 FP（8 件）の削減と GT15/GT16 の TP 化（IoU を 0.5 超に）が次の優先課題
- blob+minTB の「echo FP」（GT7/GT10 直後に発生する短窓 FP）は serve/idle 静止検出なしには削減困難

### ファイル変更

| ファイル | 変更内容 |
|---|---|
| `src/services/ball/core/rallySegment.ts` | bridge シグナル追加（`BRIDGE_BLOB_THRESH=7`, `BRIDGE_MIN_DUAL_ZONE_PX=320`）、`computeMinHalfMotion()` 関数追加 |
| `scripts/eval/debug-density.ts` | 空間分割 TSV 列（rawTopHalf/rawBotHalf/rawLeftHalf/rawRightHalf）追加 |
