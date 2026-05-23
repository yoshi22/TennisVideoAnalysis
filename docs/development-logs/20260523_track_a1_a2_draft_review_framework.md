# 2026-05-23 開発ログ: Track A1/A2 — 下書き/レビューフレームワーク

**日付**: 2026-05-23  
**対象**: CV・AI 強化トラック option 2/3/4 の精度非依存先行実装（Track A1 + A2）

## 概要

3 トラックからなる CV・AI 強化プログラム（plan: docs-velvet-sunbeam）の最初の PR 群。
精度基盤（Track B）の完成を待たずに着手できる「下書き/レビューフレームワーク」を実装した。
自動採点の候補をユーザーが確認・修正してから確定できる UI 枠組みと、
自動生成ポイントを確定統計から分離するデータモデルが中心。

## プログラム背景と意思決定

本セッションで以下の 2 点を確定した:

1. **LLM コーチングは延期・オフライン維持**: ネットワーク依存ゼロを維持し、
   当面はルールベース Tips（既存 `coachingRules`）の拡充で代替する。
2. **精度非依存の作業を先行**: blob baseline F1=0.433 の精度制約は
   下書き UI には影響しない。Track A を即着手し、Track B（精度向上）を並行で進める。

---

## Track A1 — 下書きデータモデル + confidence 貫通（Claude 実装）

### データモデル拡張

`src/types/point.ts`:

```ts
export type PointSource = 'manual' | 'auto';
export type PointReviewStatus = 'draft' | 'confirmed';

// PointRecord に追加:
source?: PointSource;
confidence?: number;       // 0..1、source='auto' のみ
reviewStatus?: PointReviewStatus;
```

`src/types/scoring.ts` `AutoPointCandidate` に追加:

```ts
confidence?: number;  // ラリー窓の検出信頼度（0..1）
```

### confidence の貫通

`RallyWindow.confidence`（`rallySegment.ts` で算出済み）は
これまで `RallyAnalysis` に届かず UI で使えなかった。以下の経路で貫通させた:

```
RallyWindow.confidence
  → analyzeRallyBatch (autoSegment.ts): { ...rawResult, windowConfidence: win.confidence }
  → RallyAnalysis.windowConfidence (ball/index.ts: 新フィールド)
  → proposeCandidates (autoScore.ts): { ...candidate, confidence: rally.windowConfidence }
  → AutoPointCandidate.confidence
```

単発 `analyzeRally` 経路（スライダー手動指定）は `windowConfidence` 無し → `undefined`。

### ManualAnalyzer ドラフト除外

`src/services/analysis/ManualAnalyzer.ts`:

- `const confirmedPoints = points.filter(p => p.reviewStatus !== 'draft')`
- serveStats・wonCount・winRate・rallyStats・弱点分析すべてで `confirmedPoints` を使用。
- 下書きポイントは「未確認の自動検出」であり、確定まで統計に影響させない。

**回帰テスト追加** (`__tests__/ManualAnalyzer.test.ts`):

下書きポイント（`source:'auto', reviewStatus:'draft'`）が
winRate・averageRallyCount のいずれにも影響しないことを検証。

---

## Track A2 — 下書き / レビュー UI（Claude 実装）

### AutoPointCard の刷新

`src/components/scoring/AutoPointCard.tsx`:

- **信頼度バッジ追加**: `confidence` が存在する場合に "信頼度 xx%" のバッジを表示。
  - ≥0.7 → `colors.success`、0.4〜0.7 → `colors.warning`、<0.4 → `colors.danger`
  - `confidence < 0.5` のとき「要確認」ラベルも付与。
- **Props 変更**:
  - `onAccept` → `onSaveDraft: (point: PointRecord) => void`（下書き保存）
  - `onConfirm: () => void`（確認シート起動）を新設
- **ボタン刷新**:
  - 旧「採用して保存」を廃止。
  - 「下書き保存」: `source:'auto', reviewStatus:'draft', confidence` を付与して保存。
  - 「確認して確定」: 親が管理する PointLogSheet を開く。
  - 「棄却」: 変更なし（単独行に移動）。

### auto-score.tsx の confirm フロー

`app/session/[id]/auto-score.tsx`:

- **状態追加**: `confirmingCandidate`・`confirmSheetOpen`
- **ハンドラ整理**:
  - `handleDraftCandidate`: 下書き保存（旧 `handleAcceptCandidate` を代替）
  - `handleOpenConfirm(candidate)`: 確認シートを開く
  - `handleConfirmSheetCommit(data)`: シートのデータ + `source:'auto'`, `reviewStatus:'confirmed'`, `confidence`, `videoTimestamp` を合成して確定保存
  - `handleConfirmSheetClose`: シートを閉じる
- **PointLogSheet 統合**: 候補の suggestedXxx フィールドを `initialPoint` として渡し
  5 ステップ補完シートで内容を確認・修正してから確定できる。
- `isPointRecord` ヘルパー関数を削除（AutoPointCard が型付き PointRecord を生成するため不要）。

### AnalysisConfidenceBanner の拡張

`src/components/common/AnalysisConfidenceBanner.tsx`:

- `draftCount?: number` prop を追加。
- `draftCount > 0` のとき「下書き n 件が未確定です。ログ画面から確定してください。」
  のインフォバナーを表示（既存の信頼度バナーと積み重ね表示）。

### レポート画面

`app/session/[id]/report.tsx`:

```ts
const draftCount = session.points.filter(p => p.reviewStatus === 'draft').length;
```
→ `<AnalysisConfidenceBanner ... draftCount={draftCount} />`

`app/(tabs)/report.tsx`:

```ts
const totalDraftCount = sessions.flatMap(s => s.points)
  .filter(p => p.reviewStatus === 'draft').length;
```
→ `<AnalysisConfidenceBanner ... draftCount={totalDraftCount} />`

### ログ画面のドラフトバッジ

`app/session/[id]/log.tsx`:

- `point.reviewStatus === 'draft'` のとき「下書き」ピルバッジを表示。
- `colors.warning` 背景 / `colors.surface` テキスト。

---

## 検証

- `npm run type-check`: エラー 0
- `npm run lint`: エラー 0（警告 8 件は既存のまま）
- `npm test -- --runInBand`: 12 suites / 81 tests 全通過

---

## 現時点の課題

1. **Simulator 動作確認**: 自動採点 → 下書き保存 → 「確認して確定」→ PointLogSheet → レポートに反映、の手動 E2E 未実施。
2. **Track A3**: コーチングルール拡充（PlayerProfile 対応・WeaknessPattern 追加）未着手。
3. **Track B1**: ラベル精緻化 + F1 再ベースライン未着手。
4. **Track C1**: サーブ速度の de-orphan 未着手。

## 次ステップ

- Track A3（コーチング拡充）と Track B1（eval ラベル精緻化）を並行で進める。
- Track C1（ball-trace de-orphan + 球速表面化）は Track A3 完了後に着手可。
