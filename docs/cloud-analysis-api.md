# CourtLens クラウド解析 API(実機E2Eの契約)

最終更新: 2026-09-13。関連: `docs/product-strategy-monetization.md`(戦略)/ `docs/development-logs/20260913_*.md`(技術経緯)。

cloud-first の「動画 → ショット毎JSON」解析エンドポイント。Modal アプリ `tennis-ball`(`scripts/eval/modal_ball.py`)。

## エンドポイント

| メソッド | URL | 用途 |
|---|---|---|
| POST | `https://yoshi22--tennis-ball-submit.modal.run` | ジョブ投入 → `call_id` |
| GET | `https://yoshi22--tennis-ball-result.modal.run?call_id=<id>` | 状態/結果ポーリング |

### POST submit(body: JSON)
```jsonc
{
  "clip_id": "<app生成id 例 submissionId>",
  "video_url": "<取得可能なmp4 URL 例 Supabase署名URL>",
  "court_corners": [[x,y],[x,y],[x,y],[x,y]],  // 正規化[0,1]。順序: near-left, near-right, far-right, far-left
  "court_type": "singles",                       // or "doubles"
  "rallies": [{"startSec": 0, "endSec": 24}],    // オンデバイス rallySegment 由来
  "handedness": "right"                           // or "left"
}
```
返り: `{"call_id": "fc-...", "clip_id": "...", "status": "queued"}`

### GET result
- 実行中: `{"call_id","status":"running"}`
- 完了: `{"call_id","status":"done","result": <CloudAnalyzeResult>}`
- 失敗: `{"call_id","status":"error","error":"..."}`

`CloudAnalyzeResult` = `{clip_id, status, court_type, normalized, frames, summary, events, strokes}`。
`events.rallies[].contacts[]` に打点(timeSec/court_xy_m/zone/speed_kmh)、`strokes.contacts[]` に FH/BH。型は `src/services/analysis/cloudAnalyze.ts` を正とする。

## サーバ側の処理(自動)
1. `video_url` を volume にダウンロード。
2. `court_corners`/`rallies` から court/labels JSON を生成。
3. **1280×720 / 30fps に正規化**しつつフレーム抽出(回転メタは ffmpeg が自動適用。**~16:9 横向き固定カメラ前提**)。
4. TrackNetV4 全フレーム推論 → 軌跡クリーン → ショットイベント(速度/コース/バウンド/打点)→ YOLO pose で FH/BH。

## アプリ側の結線(実装済 ✅ / 実機実行の手前まで完了)
`auto-score.tsx` の「クラウドでショット解析」ボタンに以下が結線済み。**残るはユーザーの設定+実機実行のみ**。
1. ✅ **設定**: `app.config.ts` の `extra.cloudAnalysis {submitUrl, resultUrl}` 追加済。
   - ⚠ **ユーザー作業**: `SUPABASE_URL` / `SUPABASE_ANON_KEY` を環境に投入(空だと `extra.submission` が空になりクラウドボタン非表示)。ローカルは `.env.local`、ビルドは EAS の `production` 環境変数。キー名は `.env.example` 参照。
2. ✅ **動画アップロード**: `src/services/analysis/videoUpload.ts`(Supabase へ PUT → 署名URL発行)。
3. ✅ **較正**: `calibration.tsx` が保存する `CourtCalibration.imageCorners`(near-left..far-left 正規化)をそのまま送信。
4. ✅ **ラリー窓**: 既存 `detectRallyWindows`(オンデバイス)→ `[{startSec,endSec}]`。
5. ✅ **解析呼び出し**: `runCloudAnalysis(...)`(`src/services/analysis/cloudAnalyze.ts`)。
6. ✅ **ラリー履歴化**: `cloudResultToRallyAnalysis(result)`(`src/services/analysis/rallyHistory.ts`)→ `addRallyAnalysis` で永続化。
7. ✅ **レビュー/補正**: `app/session/[id]/rally-history.tsx`(ショット毎のコース/速度/FH-BH ラダー + 勝ち負けトグル = 補正フライホイール)。

> 旧記述にあった `cloudResultToCandidates` / `src/services/scoring/cloudCandidates.ts` は未使用のまま残っていたためコミット `23e58c6` で削除済み。クラウド結果は `AutoPointCandidate` を経由せず、上記のラリー履歴経路に入る。

⚠ **実機実行の残り(ユーザー)**: (a) `submission.url`/`anonKey` 設定 + バケットで署名URL発行可、(b) dev build で 動画取り込み→コート較正→「クラウドでショット解析」ボタン→レビュー。

## 現状の制約(実機検証時に留意)
- **レイテンシ**(2026-09-13 最適化後, T4): 600秒クリップで **stride1 ~471s(結果同一)/ stride2 ~252s(イベント約8割)**。並列デコード(workers8)+ラリー窓内推論+バッチ16。デフォルト stride=1。near-interactive には**短尺(1-2ラリー/1ゲーム)推奨**。さらに速くするなら大型GPU。
- **速度精度**: コート較正の精度に強く依存(近似だと過大)。実機は較正UIの4隅が効く。物理フィルタ/平滑化は今後。
- **FH/BH**: 遠景プレイヤーで unknown 率が高い。
- **勝敗/結果理由**: ボール追跡から判定不可 → ドラフトは placeholder、レビューでユーザーが確定。
- **認証/課金**: 現状エンドポイントは無認証。ベータ検証用。公開前に要ガード。

## 検証済み
- 2026-09-13: gr4ves(600秒/18,002フレーム)で POST→GET のHTTP疎通、データ駆動(corners+rallies引数)で 17ラリー/279イベント再現。`src/services/analysis/cloudAnalyze.ts` は type-check/lint 通過。
