# ラリー区間ラベリング → モデル訓練パイプライン

CourtLens の固定カメラ・ラリー区間検出精度を反復的に改善するためのランブック。
発掘 → 選別 → ラベリング → GPU 訓練 → スコアリング → ゲート判定の全工程を記載する。

---

## 現在地と目標

| 指標 | 値 |
|---|---|
| 確定ラベル | 8 clip（seed 3 + 拡張 5） |
| blob baseline（event F1） | **0.433**（現行 production） |
| ML 最良（event F1） | **0.174**（TCN v1 visual-only） |
| ゲート | event F1 ≥ **0.85**（IoU≥0.5） |

ゲートを通過したらモデルを TFLite / Core ML に変換して on-device swap する。

---

## 正解データの出所

正解ラベルは **ユーザーが用意した固定カメラ動画を人が目視でラリー境界をマーク** することで作成する。
既製の公開データセットは使えない:

- **E2E-Spot**（28 試合 / 3,345 clip）、**RacketVision**（431 ゲーム / 21,544 ボール注釈）:
  どちらも**放送テニス**でドメインが違う。
- 固定カメラ・アマチュア・ソフトテニス・スコアレス・白球に合う公開ラベルは事実上存在しない。

blob 検出器（または訓練済み TCN）の pre-fill は _DRAFT を自動生成して手間を減らすだけで、
**境界の最終判断は常に人手**。

---

## 精度ロードマップ

| クリップ数 | 期待 event F1 | 備考 |
|---|---|---|
| 8（現在） | 0.09–0.17 | データ飢餓が支配的 |
| 25–30 | 0.55–0.72 | blob baseline (0.433) 超過が第一ゲート |
| 60 | 0.78–0.88 | ゲート（0.85）到達圏内 |

---

## パイプライン概要

| Phase | 内容 | 担当 | 所要時間（目安） |
|---|---|---|---|
| A 発掘 | YouTube 候補を `candidates.json` に投入 | **自動** | 5 分 |
| B 選別 | contact sheet 目視 → 固定カメラ区間を決める | **ユーザー** | 動画1本あたり 3–5 分 |
| C ラベリング | ラリー境界を動画と照合して修正 | **ユーザー** | clip あたり 30–60 分 |
| D Modal 訓練 | GPU で LOCO CV 訓練（25–30 clip 到達後） | **自動** | 30–60 分（T4 GPU） |
| E スコアリング | event F1 測定 | **自動** | 5 分 |
| F ゲート → 実装 | F1 ≥ 0.85 → TFLite / Core ML export → on-device swap | 開発 | — |

---

## Phase A: 発掘（自動）

`candidates.json` に `status: needs_screening` の新規エントリを追記する。
ダウンロードは**しない**（メタデータ取得のみ）。

```bash
# 1. dry-run でリストを確認（--write なし = dry-run 既定 / candidates.json を変更しない）
python3.11 scripts/eval/discover-candidates.py --limit 15

# 2. 問題なければ投入
python3.11 scripts/eval/discover-candidates.py --limit 15 --write
```

**既定クエリ**（ハード＋ソフトテニス、日英）:
- 「テニス シングルス 試合 コート全体」「草トーナメント テニス シングルス」「社会人 テニス シングルス 試合」
- 「ソフトテニス シングルス 試合」「ソフトテニス 大会 男子シングルス」
- "tennis singles match full court amateur"、"USTA singles match full"、"recreational tennis singles fixed camera"

カスタムクエリは `--query "..." --query "..."` で既定セットを置き換え。

---

## Phase B: 選別（★ユーザー操作）

`screen-fixed-camera-candidates.py` が動画をダウンロードし、コマ送り画像（contact sheet）と
低 fps プレビュー動画を `eval/datasets/fixed-camera-v2/screening/` に生成する。

```bash
# needs_screening の候補すべてを処理（全件 DL になるため候補数に注意）
python3.11 scripts/eval/screen-fixed-camera-candidates.py \
  --dataset fixed-camera-v2 --status needs_screening

# 特定の候補だけ処理する場合（推奨: 少量ずつ）
python3.11 scripts/eval/screen-fixed-camera-candidates.py \
  --dataset fixed-camera-v2 --candidate-id VIDEOID1 --candidate-id VIDEOID2
```

### ユーザーが判断すること

`screening/` 内の contact sheet と preview を目視して:

1. **固定カメラかどうか** — カメラが動く・カット切り替えが多い動画は除外
2. **シングルスかどうか** — ダブルスや練習動画は除外
3. **使える区間**（offsetSec/durationSec）— スポンサー画面・インタビュー等を除いた開始秒と継続秒

### 選んだら candidates.json を手動で編集

```json
{
  "id": "VIDEOID",
  ...
  "status": "selected_for_labeling",
  "selectedClips": [
    {
      "clipId": "yt-VIDEOID-clip1",
      "sourceVideoId": "VIDEOID",
      "offsetSec": 0,
      "durationSec": 900,
      "status": "needs_manual_labeling"
    }
  ]
}
```

---

## Phase C: ラベリング（★ユーザー操作 ／ 最大の作業）

1 clip あたり 30–60 分。25–30 clip 到達で Phase D に進める。

```bash
# 動画ダウンロード + フレーム抽出 + blob _DRAFT.json 自動生成
python3.11 scripts/eval/add-new-clip.py \
  --url "https://www.youtube.com/watch?v=VIDEOID" \
  --clip-id yt-VIDEOID-clip1 \
  --offset 0 \
  --duration 900
```

生成される `eval/datasets/fixed-camera-v2/labels/yt-VIDEOID-clip1_DRAFT.json` を
動画と並べて開き、各エントリを修正する:

```json
{ "startSec": 42.5, "endSec": 58.3, "server": null, "winner": null, "endReason": null }
```

**品質基準:**
- 境界精度 ±3 秒以内
- 1 clip あたり ≥15 ラリー推奨
- blob 検出器の誤検出ラリーは削除、見落としは追加

```bash
# 修正完了後: _DRAFT を本ラベルにリネーム
mv eval/datasets/fixed-camera-v2/labels/yt-VIDEOID-clip1_DRAFT.json \
   eval/datasets/fixed-camera-v2/labels/yt-VIDEOID-clip1.json

# バリデーション
python3.11 scripts/eval/validate-rally-labels.py --dataset fixed-camera-v2

# (オプション) ポーズ特徴を抽出しておく
python3.11 scripts/eval/pose-extract.py --dataset fixed-camera-v2 --clip yt-VIDEOID-clip1
```

**重要: 訓練クリップは detector pre-fill（_DRAFT）使用可。ホールドアウト（テスト）クリップは
スコアボードや検出器に頼らず scratch からラベリングすること（eval バイアス防止）。**

---

## Phase D: Modal Labs GPU 訓練（自動 ／ 25–30 clip 到達後）

```bash
# 別 venv が必須（packaging>=24 の依存衝突を避ける）
python3.11 -m venv ~/.venvs/modal-venv
source ~/.venvs/modal-venv/bin/activate
pip install modal
modal token new   # 初回のみ（ブラウザ認証）

# データセット + スクリプトを Modal Volume にアップロード
python scripts/eval/modal_train.py upload --dataset fixed-camera-v2

# GPU 訓練（T4、~$0.59/hr、30–60 分）
modal run scripts/eval/modal_train.py \
  --run-id rally-state-gru-v3 --model gru --fps 5 --epochs 200

# 結果をローカルにダウンロード
python scripts/eval/modal_train.py download --run-id rally-state-gru-v3 --also-pp
```

デフォルトのポスト処理パラメータ（GRU 向け）:
`hysteresis-lo=0.35`, `hysteresis-hi=0.50`, `gap-tol=3.0`, `start-pad=1.0`, `end-pad=2.0`, `min-dur=3.0`

---

## Phase E: スコアリング（自動）

```bash
npm run eval:score -- \
  --run-id rally-state-gru-v3-pp \
  --dataset fixed-camera-v2 \
  --baseline-run-id iter-v2-expanded-blob1
```

これが**実ゲート指標**。`train.py` の frame-level F1 は近似値なので参考のみ。

| 確認項目 | 基準 |
|---|---|
| event F1（aggregate） | ≥ 0.85（IoU≥0.5） |
| クリップ回帰 | ≤ -0.05（5% 以上悪化したクリップが無い） |

---

## Phase F: ゲート通過 → on-device 実装（開発）

ゲート通過後:

1. **TFLite export**（Android）または **Core ML export**（iOS）
2. `src/services/ball/core/rallySegment.ts` の blob 実装を新モデルに swap
3. `app/session/[id]/auto-score.tsx` の推論パイプラインを更新

**制約（変更禁止）:**
- 推論時に scoreboard / OCR / score-state を使うこと — 禁止
- `scripts/eval/score-stage1.ts`（公式スコアラー）— 変更禁止

---

## 参照ドキュメント

- `docs/tennis_rally_interval_detection_research.md` — ドメイン調査・公開データセット評価
- `eval/datasets/fixed-camera-v2/README.md` — dataset expansion protocol（詳細手順）
- `eval/datasets/fixed-camera-v2/candidates.json` — 候補動画バックログ
- `docs/development-logs/` — 各サイクルの実験ログ
