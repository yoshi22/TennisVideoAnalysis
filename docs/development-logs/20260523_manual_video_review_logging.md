# 2026-05-23 開発ログ: 手動動画レビュー記録への方針転換

**日付**: 2026-05-23  
**対象**: CourtLens 手動記録 MVP / Phase 0.9  
**背景**: `docs/development-logs/03_ai_analysis_roadmap.md` と `docs/roadmap.md` に基づき、初期版は動画解析精度に依存せず、撮影済み動画を見返しながら低ストレスで必要事項を記録できる体験を優先する。

## 概要

ユーザーが動画を見ながらポイントを記録する際、従来の詳細入力シートだけでは、再生を止めて複数項目を選ぶ負荷が高い。そこで、初期記録は「現在の動画時刻 + 得点/失点」だけを1タップで保存し、ショット種別、結果理由、ラリー数、コースは後から補完する構成へ変更した。

この変更により、動画レビュー中は視線と操作を途切れさせずにポイントを刻み、分析に必要な詳細は Log タブで後から整理できる。

## 実装内容

### 手動レビュー記録

- `app/session/[id]/video.tsx`
  - Video タブに quick logging dock を追加。
  - 現在時刻、現在スコア、`得点` / `失点`、直前 `取り消し` を常時表示。
  - `VideoPlayerRef.getCurrentTime()` を使い、保存時点の `videoTimestamp` を `PointRecord` に保存。
  - 記録直後にタイムラインマーカーとマーカー一覧へ反映。
  - quick ポイントは一覧上で `詳細未入力` / `後で補完` として表示。

### データモデル

- `src/types/point.ts`
  - `PointRecord.shotType`、`resultReason`、`rallyCount` を任意化。
  - `detailStatus: 'quick' | 'complete'` を追加。
- `src/utils/pointDetails.ts`
  - `isPointComplete` と `getPointDetailStatus` を追加。
  - 既存データは詳細項目が揃っていれば `complete` とみなす。

### 補完導線

- `app/session/[id]/log.tsx`
  - ポイント行タップで詳細入力シートを開き、既存ポイントを編集できるようにした。
  - quick ポイントに `タップして詳細を入力` を表示。
  - `すべて` / `未補完` フィルタと、詳細入力済み件数を追加。
- `src/components/point/PointLogSheet.tsx`
  - `initialPoint` を受け取り、既存ポイントの補完シートとして再利用可能にした。
  - 補完保存時は `detailStatus: 'complete'` を付与。
- `src/stores/sessionStore.ts`
  - `updatePoint(sessionId, pointId, patch)` を追加。

### 分析・エクスポート

- `src/services/analysis/ManualAnalyzer.ts`
  - 得点率は全ポイントを対象に維持。
  - ラリー平均、ショット別、弱点検出は詳細入力済みポイントを対象にする。
- `app/session/[id]/report.tsx` / `app/(tabs)/report.tsx`
  - 詳細入力済み件数と未補完件数を表示。
  - 未補完ポイントがある場合、ショット内訳、ヒートマップ、弱点分析は詳細入力済みポイントをもとに表示する旨を明示。
- `src/services/export/markdown.ts`
  - quick ポイントがある場合も Markdown レポートが破綻しないようにした。
  - 詳細入力済み件数、詳細未入力件数、分析対象の注記を出力。
- `src/services/export/csv.ts`
  - quick ポイントでも空欄を保ったまま CSV 出力できるようにした。
  - `detailStatus` 列を追加し、外部確認時にも quick / complete を判別できるようにした。

### テスト

- `__tests__/ManualAnalyzer.test.ts`
  - quick ポイントを含むセッションでも得点率とラリー平均が安全に計算されることを追加検証。
- `__tests__/services/export/csv.test.ts`
  - quick ポイントの詳細列が空欄になり、`detailStatus` が出力されることを追加検証。
- `__tests__/stores/sessionStore.test.ts`
  - `updatePoint` で quick ポイントを complete に補完できることを検証。

## 検証

- `npm run type-check`: 成功
- `npm test -- --runInBand`: 成功（12 suites / 79 tests）
- `npm run lint`: エラーなし。既存 warning 8 件のみ。

## 現時点の課題

1. 実機または Simulator で、片手操作、誤タップ復旧、動画視聴中の視線移動量を確認する。
2. quick 記録後のフィードバック表示時間、配置、文言を実機で調整する。
3. 補完シート内で、動画時刻へ戻る導線や前後ポイント移動を追加するか検討する。
4. 分析レポート上で、詳細入力済み件数が少ない場合の信頼度表示をさらに明確にする。

## 次ステップ

- Phase 0.9 は、手動レビュー UX の品質固めを優先する。
- Phase 1.0 は、未補完データを含む分析レポートの信頼性表示を強化する。
- 動画解析は Phase 1.5 以降で、自動下書きとして接続する。現時点では初期導線にしない。
