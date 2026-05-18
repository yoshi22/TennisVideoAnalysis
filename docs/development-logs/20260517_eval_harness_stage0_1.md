# Phase 8: Eval Harness 構築 & Stage 1 反復改善ループ

**日付**: 2026-05-17  
**担当**: Claude (自律実行) + codex (アルゴリズム改善)

---

## 目的

YouTube テニス動画を題材に、現在の自動ラリー区間検出（`detectRallyWindowsFromFrames`）の精度を実測・改善する。

**目標 (Stage 1)**: dev set 平均 Event F1 @ IoU≥0.5 ≥ 0.85, boundary p90 < 2s

---

## Stage 0 完了サマリ（実装済み）

### 作成ファイル
| パス | 役割 |
|---|---|
| `src/services/ball/core/types.ts` | `DecodedFrame` 型（RN/Node 共有） |
| `src/services/ball/core/frameDiff.ts` | 純関数: 動きマスク計算 |
| `src/services/ball/core/blobDetect.ts` | 純関数: blob 検出 |
| `src/services/ball/core/tracker.ts` | 純関数: ボール追跡 |
| `src/services/ball/core/bounceDetect.ts` | 純関数: バウンス検出 |
| `src/services/ball/core/rallySegment.ts` | 純関数: `detectRallyWindowsFromFrames()` |
| `src/services/ball/core/decodeFrame.node.ts` | Node 用 JPEG デコーダ |
| `scripts/eval/lib/types.ts` | GroundTruth / EvalMetrics 型 |
| `scripts/eval/lib/metrics.ts` | IoU, F1, precision/recall 計算 |
| `scripts/eval/lib/frameSampler.node.ts` | ffmpeg wrapper |
| `scripts/eval/lib/codex-handoff.ts` | codex プロンプト生成 |
| `scripts/eval/fetch-video.ts` | yt-dlp wrapper |
| `scripts/eval/clip-video.ts` | ffmpeg clip |
| `scripts/eval/extract-frames.ts` | ffmpeg frame extraction |
| `scripts/eval/run-stage1.ts` | ラリー検出パイプライン |
| `scripts/eval/score-stage1.ts` | メトリクス計算 |
| `scripts/eval/visualize.ts` | SVG タイムライン生成 |

### 改変ファイル
- `src/services/ball/{frameDiff,blobDetect,tracker,bounceDetect}.ts` → core/ への re-export
- `src/services/ball/decodeFrame.ts` → DecodedFrame を core/types から re-export
- `src/services/ball/autoSegment.ts` → IoC 化（detectRallyWindowsFromFrames を露出）
- `src/services/ball/index.ts` → detectRallyWindowsFromFrames を追加 export
- `package.json` → tsx 追加, eval:* スクリプト追加
- `.gitignore` → eval/datasets/videos 等を除外

### 検証済み
- `npm run type-check` → エラー 0
- `npm test` → 58 テスト全通過

---

## Stage 1: データセット作成 & ベースライン測定

### Step 1: 動画選定・ダウンロード方針
- プロ試合放送映像（WTA/ATP 公式 YouTube チャンネル）
- 高アングル固定カメラ（ベースライン方向からの俯瞰）
- 1 クリップ = 5-10 分の dense rally 区間
- dev set 5 本 + test set 3 本（合計 8 本）

### Step 2: フレーム抽出
- 3 fps（デフォルト）で JPEG 列を生成
- 1 秒ごとにフレームを目視してラリー区間を特定

### Step 3: Ground Truth ラベリング方針
- ラリー開始 = サーブモーションの直前（ボールトス前）
- ラリー終了 = 最後のショット後にコートから外れる瞬間 + 0.5s
- `schemaVersion: 1` JSON で保存

---

## 反復ログ

| Iter | Run ID | AO F1 | WIMB F1 | Dev F1 | 変更内容 |
|------|--------|-------|---------|--------|---------|
| pre  | iter2-pre | 0.645 | 0.387 | 0.516 | ベースライン（旧定数: GAP=5, PAD=3+4, MAX_BLOB=20, MAX_DUR=90） |
| 2    | iter2 | 0.222 | 0.353 | 0.288 | **REGRESSED** codex: GAP=5→3, PAD=3+4→1+2 |
| 2b   | iter2b | 0.222 | 0.303 | 0.263 | **REGRESSED** GAP=5(reverted), PAD=1+2 |
| 2c   | iter2c | 0.645 | 0.387 | 0.516 | ベースライン復元（PAD=3+4 reverted） |
| 3    | iter3 | TBD | TBD | TBD | GAP=5→4（仮説: Wimb GT12-GT13 gap=5s を切断） |

---

## 詳細分析: iter2 系失敗の根因

### paddings を 3+4→1+2 に減らした効果

**AO GT11 (488-538s, 50s long rally):**
- 生検出は 2 クラスタに分かれる: [489-493s] と [509-531s], クラスタ間ギャップ=16.3s >> gapTolerance
- 旧パディング(3+4=7s): クラスタ B → padded (506.3, 534.6), IoU with GT11 = 28.3/50 = **0.57 ✓**
- 新パディング(1+2=3s): クラスタ A と B が近い別サブクラスタに再分割される
  - サブクラスタ [509-521s] padded → (508.3, 523.3): IoU = 15/50 = 0.30 ✗
  - サブクラスタ [528-531s] padded → (527, 532.6): IoU = 4.6/50 = 0.09 ✗
  - → GT11 全て FN（旧では 1 TP）

**Wimbledon GT2 (28-42s):**
- 旧パディング: detected (25.0, 37.0), IoU = 9/17 = **0.53 ✓**
- 新パディング: detected (27.0, 35.0), IoU = 7/15 = 0.47 ✗（閾値0.5ギリギリ届かず）

**結論**: 両動画に対してパディング削減は有害。iter2 は全 revert 必要。

### gapTolerance を 5→3 に減らした効果

AO window 9 (GT7=233-258s): 内部の 4-5s ギャップで分割 → 4 サブウィンドウになり全て IoU<0.5。

### Wimbledon 大偽陽性窓の根因

| 偽陽性窓 | 持続時間 | 関係する GT |
|---------|---------|-----------|
| 84.4-128.1s | 43.7s | GT5 (95-107), GT6 (113-130) を1窓に吸収 |
| 139.4-182.5s | 43.0s | GT7 (168-183) を1窓に吸収 |
| 361.6-401.9s | 40.3s | GT12 (358-372), GT13 (377-393) を1窓に吸収 |

根因: サーブ前のボールバウンス (~3-5s) が隣接ラリー間の生検出ギャップを埋め、gapTolerance=5s の範囲内に収まる。

**GT12-GT13 の間のギャップは約 5s**（GT12終了377s... いや GT12=358-372, GT13=377-393, gap=5s）。gapTolerance=4 にすれば切断できる可能性がある。

---

## 詳細分析: iter2-pre Wimbledon の TP/FP 内訳

| 検出窓 | 対応 GT | IoU | 判定 |
|--------|---------|-----|------|
| 3.3-19.0 | GT1 (13-22) | 0.32 | FP |
| 25.0-37.0 | GT2 (28-42) | 0.53 | **TP** |
| 66.0-75.0 | GT4 (68-83) | 0.41 | FP |
| 84.4-128.1 | GT5+GT6 吸収 | - | FP (大) |
| 139.4-182.5 | GT7 吸収 | - | FP (大) |
| 197.8-219.8 | GT8 (200-225) | 0.73 | **TP** |
| 224.5-236.8 | (GT8 重複) | - | FP |
| 249.2-271.9 | GT9 (253-267) | 0.62 | **TP** |
| 286.2-317.9 | GT10 (290-313) | 0.73 | **TP** |
| 327.9-340.9 | GT11 (330-347) | 0.57 | **TP** |
| 361.6-401.9 | GT12+GT13 吸収 | - | FP (大) |
| 435.0-448.0 | GT14 (430-453) | 0.57 | **TP** |
| 515.4-539.4 | GT15 (518-530) | 0.50 | FP (IoU=0.50, 閾値は>0.5) |
| 566.1-577.1 | GT16 (554-578) | 0.46 | FP |
| 592.1-603.7 | (GT なし) | - | FP |

TP=6, FP=9, FN=10 → P=0.40, R=0.375, F1=0.387

---

## メモ・観察

### 2026-05-18: iter3 仮説

**仮説**: gapTolerance=4 にすると Wimbledon GT12-GT13 間の ~5s ギャップ が切断される。
- GT12 (358-372) と GT13 (377-393) が別窓で検出 → 各 IoU >0.5 期待
- AO への影響: GT11 の TP は "パディング重ね合わせ" によるもので gapTolerance 変更非依存 → AO 変化なし期待
- リスク: AO の他窓内部に 4-5s ギャップが存在する場合は AO FN が増える

### Stage 1 現況と方針転換（2026-05-18）

目標 F1≥0.85 に対してベースラインは 0.516。主なギャップ:
1. Wimbledon の偽陽性大窓（3 窓）で 4 GT ラリーが吸収されている
2. AO で 9 FP（サーブ前バウンス, スコアグラフィック等）
3. 両動画とも境界精度が低い（Start MAE=5.15s）

**方針転換**: `pro-broadcast-v1` は eval ターゲットから外してアーカイブ扱いへ。
理由: broadcast 映像の偽陽性要因（リプレイ・クローズアップ・スコアグラフィック）は CourtLens の実ユースケース（固定三脚カメラ録画）と乖離。

→ 新データセット `fixed-camera-v1`（YouTube アマチュア硬式テニス、固定カメラ）を構築し、そちらでベースライン測定・iter ループを再起動する。

開発ログの続き: `docs/development-logs/20260518_eval_fixed_camera_v1.md` を参照。
