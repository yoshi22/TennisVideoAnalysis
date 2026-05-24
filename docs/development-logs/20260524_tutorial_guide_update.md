# 開発ログ: チュートリアル・使い方ガイド更新 (2026-05-24)

## 概要

v1.0（ラリー区間捕捉）・v1.1（訓練データエクスポート）の実装完了を受け、
初回起動チュートリアル（`app/onboarding.tsx`）と使い方ガイド（`app/help.tsx`）を最新機能に合わせて更新した。
実装は Claude（チュートリアル carousel）と Codex（使い方ガイド FAQ）に分担。

---

## 変更ファイル

### `src/components/onboarding/MockRallyIntervalCard.tsx` (新規)

- onboarding の新ステップ用の静的ビジュアルカード
- `MockAutoScoreCard.tsx` のパターンを踏襲: `useTheme()` のカラートークンのみ使用
- 表示内容: 「▶ ラリー開始 00:42」チップ / 区間バー「00:42〜00:58」/ 得点・失点ボタン（モック）

### `app/onboarding.tsx`

- `LAST_STEP_INDEX` を 6 → 7 に更新（ステップ追加に伴う carousel 長変更）
- `STEPS` 配列に「⑥ ラリー区間を記録」（index 6）を追加:
  - 自動採点（index 5）と競技選択（index 7）の間に挿入
  - body: 「▶ ラリー開始をマーク」→ 得点/失点 で区間保存の手順と、ラベル・動画書き出しによるモデル貢献の案内
- `renderVisual(6)` に `<MockRallyIntervalCard />` を追加
- `MockRallyIntervalCard` import 追加
- dots・ページング・スキップ・「次へ/完了」は `STEPS.length` ベースのため自動追従

### `app/help.tsx`

- **追加** 「ラリー区間を記録するには」: 動画タブの 2 タップ操作手順（▶ ラリー開始をマーク → 得点/失点）を説明
- **更新** 「動画で特定ポイントを確認するには」: 区間表示（`00:42〜00:58`）と「▶ ラリー区間を確認」ジャンプボタンの文言に更新
- **更新** 「データをエクスポートするには」: 「ラリーラベル (JSON)」「動画を共有」の追加選択肢を記載
- **追加** 「ラリーラベル・動画を書き出す目的は」: オプトイン・自動送信なし・端末内完結のデータ提供の趣旨を説明

---

## 実装方針・制約

- カラーはすべて `useTheme()` から取得。静的 `colors` 直接 import なし（CLAUDE.md 厳守）
- UI 文言は実際の画面テキスト（video.tsx:283-285, log.tsx, ExportMenu.tsx:113-136）と完全一致
- 状態管理・ルーティング・ビジネスロジックには一切触れない（表示文言・案内 UI のみの変更）
- `npm run type-check && npm run lint` — 0 errors

---

## 検証結果

| 項目 | 結果 |
|---|---|
| `type-check` | ✅ 0 errors |
| `lint` | ✅ 0 errors |
| onboarding carousel ステップ数 | 0→7 の 8 ステップ（dots・スキップ・「次へ/完了」正常） |
| help FAQ 項目数 | 8 → 10 項目（追加 2・更新 2） |
