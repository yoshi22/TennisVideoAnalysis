# 候補動画の発掘自動化（discover-candidates.py）

**日付**: 2026-05-24  
**前回**: `20260524_tooling_hardening.md`  
**目的**: クリップ拡張 8→25-30 のボトルネック（候補バックログ枯渇）を解消する発掘ツールの構築

---

## 背景

ツール堅牢化サイクル完了時点で、`candidates.json` の候補6件のうち**5件は既にラベル済み**、
残るは `-FQkEndhdNo`（フェンス遮蔽の hard-case、優先度6）の1件のみと判明。
25-30 clip 到達には +17-22 本の新規候補が必要だが、発掘のための自動化ツールが存在しなかった。

選別ツール（`screen-fixed-camera-candidates.py`）は既存エントリの download + contact sheet 生成のみで、
**YouTube からの新規候補探索機能を持たない**。

---

## 正解データ（ground-truth）の出所

ラベリングに使う正解データは **ユーザーが用意した固定カメラ動画を人が目視でラリー境界をマーク** することで作成する。
既製の公開データセットは使えない：

- **E2E-Spot** (28 試合 / 3,345 clip): 放送テニス — ドメインが違う
- **RacketVision** (431 ゲーム / 21,544 ボール注釈): 放送テニス + ボール点ラベルでラリー区間ではない
- 固定カメラ・アマチュア・ソフトテニス・スコアレス・白球に合う公開ラベルは事実上存在しない

検出器（blob / TCN）の pre-fill は下書きを作って手間を減らすだけで、境界の最終判断は常に人手。

---

## 実装した発掘ツール

### `scripts/eval/discover-candidates.py`（Codex 実装）

yt-dlp 検索クエリで YouTube から新規候補を発掘し、`candidates.json` に `needs_screening` エントリを追記する。

**インターフェース**:
```bash
# dry-run（既定）: candidates.json を変更しない
python3.11 scripts/eval/discover-candidates.py [--query "..."] [--limit 15]

# 書き込み
python3.11 scripts/eval/discover-candidates.py --write

# カスタムクエリ（既定セットを置き換え）
python3.11 scripts/eval/discover-candidates.py \
  --query "テニス シングルス 試合 コート全体" --limit 25 --write
```

**主要機能**:
- **既定クエリ8本**: ハード＋ソフトテニス（日英）— ソフトテニスは未開拓ドメインのため明示的に含む
- **duration フィルタ**: 600-5400 秒（10-90 分）、Shorts/ダイジェストを除外
- **dedupe**: 既存 `candidateVideos[].id`, `selectedClips[].sourceVideoId`, seed clips, 確定ラベルの `sourceUrl` YouTube id をすべて排除
- **dry-run 既定**: `--write` がなければ `candidates.json` を変更しない
- **スキーマ追従**: 既存 `candidates.json`（schemaVersion 1）に `needs_screening` エントリを追記

---

## 検証結果

### dry-run（クエリ2本、limit 5）

```
# クエリ: "テニス シングルス 試合 コート全体", "ソフトテニス シングルス 試合"
  1  J9bPhl_KZ3E   0:12:27   【できてない人が多すぎる】まず初めに押さえるべきシングルスの...  テニス シングルス 試合 コート全体
  2  E-LyDOjFzHQ   0:41:30   #超速報【横浜慶應CH2023/シングルス決勝戦】綿貫陽介...       テニス シングルス 試合 コート全体
  3  XLSamYktmUo   0:18:29   【インカレ テニス】２０１８ 決勝　望月勇希 VS 羽澤慎治...    テニス シングルス 試合 コート全体
  4  EsKJJnHLITQ   0:31:16   2026年 全日本シングルスソフトテニス選手権大会 男子 決勝...   ソフトテニス シングルス 試合
  5  k0kzB-_mcOs   0:26:19   2025年 全日本シングルスソフトテニス選手権大会 男子 決勝...   ソフトテニス シングルス 試合
  ...
8 new candidates found (dry-run). Add --write to persist.
```

- ✅ 既存6 id が除外されていることを確認（重複なし）
- ✅ duration フィルタ正常（すべて 10-68 分の範囲）
- ✅ `git diff --stat eval/datasets/fixed-camera-v2/candidates.json` → 出力なし（ファイル変更なし）
- ✅ ソフトテニス候補が返ること確認（items 4-8 はソフトテニス公式戦）

### 注記

検索結果には固定カメラでない動画（放送、ハウツー動画）も含まれる。これは意図どおりで、
**固定カメラ判定は screen-fixed-camera-candidates.py の contact sheet 目視が担う**。

---

## 次の全体フロー

```bash
# Phase 1: 発掘（新規候補を candidates.json へ）
python3.11 scripts/eval/discover-candidates.py --limit 15 --dry-run  # 品質確認
python3.11 scripts/eval/discover-candidates.py --limit 15 --write    # 投入

# Phase 2: 選別（contact sheet 生成 → 目視で固定カメラを選ぶ）
python3.11 scripts/eval/screen-fixed-camera-candidates.py \
  --dataset fixed-camera-v2 --status needs_screening

# Phase 3: 区間確定 → ラベル（既存フロー）
python3.11 scripts/eval/add-new-clip.py \
  --url "https://www.youtube.com/watch?v=XXXX" \
  --clip-id yt-XXXX-clip1 --offset 0 --duration 900
# → _DRAFT を目視修正 → リネーム → validate

# Phase 4: 25-30 clip 到達後: Modal GPU 訓練
source ~/.venvs/modal-venv/bin/activate
python scripts/eval/modal_train.py upload
modal run scripts/eval/modal_train.py \
  --run-id rally-state-gru-v3 --model gru --fps 5 --epochs 200
python scripts/eval/modal_train.py download --run-id rally-state-gru-v3 --also-pp
npm run eval:score -- --run-id rally-state-gru-v3-pp \
  --dataset fixed-camera-v2 --baseline-run-id iter-v2-expanded-blob1
```

---

## 変更ファイル

```
scripts/eval/discover-candidates.py    (新規) 候補発掘自動化
```
