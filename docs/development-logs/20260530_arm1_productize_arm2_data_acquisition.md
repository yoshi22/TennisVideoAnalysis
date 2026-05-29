# 2026-05-30: Arm 1 製品化完了 + Arm 2 データ取得開始

## Arm 1: 自動ラリー検出を主導線へ昇格（完了）

### 変更ファイル
- `app/session/[id]/video.tsx`: 「自動ラリー検出」ボタンをマーカーリスト上部に追加
- `app/session/[id]/auto-score.tsx`:
  - SLIDER_MAX=60s キャップ撤廃 → videoDurationSec ベースの動的スライダー
  - courtCalibration を detectRallyWindows の必須条件から除外
  - 較正なし → detectRallyWindows のみ → 全ウィンドウを draft PointRecord として直接追加
  - 較正あり → 従来通り analyzeRallyBatch + proposeCandidates で採点候補
  - 較正カード: ブロッカー表示 → オプション強化表示に変更
  - draftCount サクセスカード追加
- **codex レビューで指摘されたバグ修正**: video.tsx の detailCard に `source:'auto'` + `reviewStatus:'draft'` ポイント専用の「得点/失点」トグルボタンを追加（outcome のプレースホルダー修正不可問題を解決）

### テスト結果
`type-check 0 errors / lint 0 / 133 tests passed`

## Arm 2: データ取得・eval ベースライン確認

### 現行 blob ベースライン（8 クリップ固定カメラ v2）
| 設定 | F1 |
|---|---|
| デフォルト | 0.433 |
| split-sensitive（最良チューニング） | 0.487 |
| **ゲート目標** | **≥ 0.85** |

### 注意: コードバージョンによる違い
- `iter-fc6-3clip` (git ad64bbb) での muko-clip1 F1=0.769 は**旧コード版**の結果
- 現行コード（bridge signal + refined windows 追加済み）では同パラメータで F1=0.114
- 現行コードの正規ベースラインは `iter-v2-expanded-blob1`/`loco-tune2` を使用すること

### 新クリップ取得（毎トーシリーズ・固定カメラ・ソフトテニス）
- `yt-gr4ves-ntp4-clip1`: 杉村太蔵 vs 向和彦、17 DRAFT ラリー
- `yt-xtot94gbyee-clip1`: 杉村太蔵 vs 山岸徹郎、21 DRAFT ラリー
- `yt-ymlqebptzgo-clip1`: 杉村太蔵 vs 比嘉明人、19 DRAFT ラリー

DRAFT ラベルはブロブ検出器によるプリフィル済み。ユーザーによる境界修正待ち。

## 次のステップ（ユーザー確認後）
1. DRAFT ラベル修正 → 11 クリップで re-eval（split-sensitive設定）
2. rally_state ML モデル再学習（rasterize → extract_features → train → tune_postprocess）
3. 結果に基づき codex-handoff ループで検出器改善
4. ゲート F1≥0.85 の到達状況を正直に記録

## ブランチ
`feat/video-analysis-productize` → origin に push 済み
