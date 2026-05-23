# 2026-05-23 開発ログ: Phase 0.9 完了 / Phase 1.0 着手

**日付**: 2026-05-23
**対象**: Phase 0.9 手動レビュー記録の品質固め + Phase 1.0 分析信頼度表示

## 概要

前セッションで実装した手動動画レビュー記録（Phase 0.9）に整合バグが判明したため修正し、あわせて UX 磨き込みと Phase 1.0（未補完データの信頼度表示）を着手した。実装は Claude 統括 / Codex 逐次委譲の方針で進めた。

## Step 1 — 整合バグ修正（ManualAnalyzer, Claude 実装）

### バグ内容

「complete（補完済み）」の判定が2か所で異なっていた:

- `isPointComplete`（`src/utils/pointDetails.ts`）: `shotType && resultReason && rallyCount` をすべて要求
- `ManualAnalyzer.detectWeaknesses` の内部フィルタ: `shotType && resultReason` のみで判定

結果として `shotType + resultReason` はあるが `rallyCount` がないポイントが、弱点分析の母数には入る一方 UI 上では「未補完」と表示され、信頼度しきい値（unforcedError 率・shortRally 等）がずれていた。

### 修正内容

`src/services/analysis/ManualAnalyzer.ts`:

- `analyze` 冒頭で `const completePoints = points.filter(isPointComplete)` を一度算出。
- `calculateRallyStats` / `calculateShotBreakdowns` / `detectWeaknesses` に `completePoints` を渡す。
- `detectWeaknesses` 内のインラインフィルタを削除し `points.length` を `totalPoints` に使用。
- `calculateServeStats` と `winRate` は全ポイント対象を維持（得点率の根幹）。

`__tests__/ManualAnalyzer.test.ts`:

- 回帰テスト追加: `shotType + resultReason` があり `rallyCount` が欠落したポイントが、ラリー平均・弱点分析の母数に入らないことを検証。

## Step 2 — undo スタック拡張（video.tsx, Codex 実装）

`app/session/[id]/video.tsx`:

- `lastLoggedPoint: ... | null` → `undoStack: { id, outcome, timeSec }[]` に変更。
- `handleQuickLog`: スタック末尾に push。
- `handleUndoLast`: スタック末尾を pop して `deletePoint`。空なら何もしない。
- 「取り消し」ボタン disabled: `undoStack.length === 0`。
- フィードバック表示: スタック末尾エントリの時刻・得点/失点を表示。

## Step 3 — 補完シート導線強化（PointLogSheet + log.tsx, Codex 実装）

`src/components/point/PointLogSheet.tsx`:

- optional props を追加: `onGoToVideo`, `onPrev`, `onNext`, `hasPrev`, `hasNext`。
- `videoTimestamp` を持つポイントの編集時に「◀ 動画で確認 (m:ss)」リンクを表示。
- シート下部に前/次ポイント移動ボタンを追加（`hasPrev || hasNext` のとき表示）。

`app/session/[id]/log.tsx`:

- `editingIndex: number | null` で対象ポイントのインデックスを追跡。
- `moveEditSheet(delta)`: index を ±1 して `initialPoint` を差し替え（シートを閉じずに連続補完）。
- `handleGoToVideo`: `setPendingSeek(sessionId, videoTimestamp)` → `push(/session/${id}/video)`。
- ポイント行にも「▶ 動画で確認」リンクを追加（videoTimestamp がある場合のみ）。

## Step 4 — Phase 1.0 分析信頼度バナー（Codex 実装）

`src/components/common/AnalysisConfidenceBanner.tsx`（新規）:

```
completeCount < 5  → low:  警告色バナー「分析には5件以上の詳細入力が必要です（現在 n 件）」
5 ≤ count < 10    → mid:  情報バナー「分析対象: n 件（精度向上には10件以上推奨）」
count ≥ 10        → high: 非表示（null）
```

- `app/session/[id]/report.tsx`: 既存 `completePointCount` を使ってショット内訳・弱点分析の直前に挿入。
- `app/(tabs)/report.tsx`: セッション全体の合計 `totalCompleteCount` を算出して挿入。

## 検証

- `npm run type-check`: エラー 0
- `npm run lint`: エラー 0（警告 8 件は既存のまま）
- `npm test -- --runInBand`: 12 suites / 80 tests 全通過（回帰テスト含む）

## 現時点の課題

1. 実機またはシミュレーターで、undo スタック・「動画で確認」遷移・前後ナビの片手操作感を確認する。
2. 低信頼度バナーの文言・配色を実機で確認し、必要に応じて調整する。

## 次ステップ

- Simulator での手動 UX 確認（CLAUDE.md: testID / テキストベース操作、座標禁止）。
- Phase 1.5 では自動ラリー検出（blob F1=0.433）を「編集可能な下書き」として接続する予定。
