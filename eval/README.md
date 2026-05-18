# CourtLens Eval Harness

オフライン評価ループ用のデータセットと結果ディレクトリ。

## ⚠️ 法的注意事項

- `eval/datasets/*/videos/` と `clips/` と `frames/` はすべて **gitignore** 済みで commit しない
- ダウンロードした動画は個人研究目的に限定。再配布・共有禁止。
- 必要がなくなり次第削除推奨（48h を目安）
- YouTube ToS および著作権法の範囲内で使用すること

## ディレクトリ構造

```
eval/
├── datasets/
│   └── pro-broadcast-v1/           # データセット名
│       ├── videos/                 # gitignore: yt-dlp でDL した mp4
│       ├── clips/                  # gitignore: 5-10 分に切り出したクリップ
│       ├── frames/                 # gitignore: ffmpeg で抽出した JPEG
│       └── labels/                 # ✅ commit 対象: 手書き ground truth JSON
└── results/                        # gitignore: 評価結果（run ごと）
    └── <run-id>/
        ├── manifest.json           # git SHA + 設定値
        ├── metrics.json            # 集約メトリクス (EvalMetrics 型)
        ├── per-video/              # 動画ごとの検出結果 (VideoRunResult 型)
        └── timelines/              # SVG タイムライン（codex handoff 用）
```

## 使い方（Stage 1: ラリー区間検出）

```bash
# 1. YouTube 動画をダウンロード
npm run eval:fetch -- <YouTube URL> --dataset pro-broadcast-v1 --id us-open-2024-qf-clip1

# 2. 5-10 分の dense rally 区間を切り出す
npm run eval:clip -- --dataset pro-broadcast-v1 --id us-open-2024-qf-clip1 --start 3600 --duration 480

# 3. フレームを抽出（デフォルト 3 fps）
npm run eval:frames -- --dataset pro-broadcast-v1 --id us-open-2024-qf-clip1 --fps 3

# 4. ラベル JSON を手書きする
# → eval/datasets/pro-broadcast-v1/labels/us-open-2024-qf-clip1.json を作成（下記スキーマ参照）

# 5. ラリー検出を実行
npm run eval:run1 -- --dataset pro-broadcast-v1 --run-id baseline

# 6. メトリクスを計算
npm run eval:score -- --run-id baseline --dataset pro-broadcast-v1

# 7. 失敗ケースを可視化（codex handoff 用）
npm run eval:viz -- --run-id baseline --dataset pro-broadcast-v1 --top-n 3
```

## ラベル JSON スキーマ

```json
{
  "schemaVersion": 1,
  "videoId": "us-open-2024-qf-clip1",
  "sourceUrl": "https://www.youtube.com/watch?v=XXXXXXXXX",
  "sourceSha256": "abcdef1234...",
  "fps": 25,
  "clipOffsetSec": 3600,
  "rallies": [
    {
      "startSec": 4.2,
      "endSec": 18.7,
      "server": "near",
      "winner": "near",
      "serveSpeedKmh": 185
    }
  ]
}
```

## dev set / test set 分割

- **dev set** (5-7 動画): 反復改善ループで使用する。codex がアルゴリズムを調整する際のフィードバック源。
- **test set** (3 動画): **最終評価時のみ使用**。開発中は絶対に触らない。

test set の videoId は `labels/` に `_test_` プレフィックスを付けて管理し、スコアリング時に分けること。

## Stage 1 合格基準

- dev set 平均: `eventF1 ≥ 0.85` かつ `boundary p90 < 2.0s`
- test set: `eventF1 ≥ 0.80`
- 3 イテレーション連続で dev 基準を維持してから Stage 2 へ進む

## 反復ループ（codex 連携）

各イテレーション:
1. `npm run eval:run1 -- --dataset pro-broadcast-v1 --run-id iter-N`
2. `npm run eval:score -- --run-id iter-N --dataset pro-broadcast-v1 --baseline-run-id baseline`
3. `npm run eval:viz -- --run-id iter-N --dataset pro-broadcast-v1`
4. `scripts/eval/lib/codex-handoff.ts` で codex 用プロンプトを生成
5. `mcp__codex__codex` に渡して改善コードを生成させる
6. diff レビュー → `npm run type-check && npm run lint && npm test`
7. `regressionGuard.rejected === true` → マージ拒否、再依頼
8. 通過したらコミット、次のイテレーションへ
