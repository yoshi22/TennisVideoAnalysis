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

1. clip2 (muko-clip2) と fukui-clip1 のラベリング（dev set 拡充）
2. iter 1 codex 実行（上記ブリーフで）
3. iter 1 結果スコア → F1 改善を確認
4. dev set 5+ 本になったら iter ループ本格化

---

## ファイル変更記録

| ファイル | 変更内容 |
|---|---|
| `scripts/eval/lib/frameSampler.node.ts` | `-q:v 5`, `scale=1280:-1` 追加でディスク使用量 44% 削減 |
| `eval/datasets/fixed-camera-v1/labels/yt-maitou-suzumura-muko-clip1.json` | 新規作成（18 ラリー、±5s 精度） |
| `eval/results/fixed-baseline/` | Phase B ベースライン結果（F1=0.000） |
