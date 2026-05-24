# 方針転換: 手動記録サービス化 + ユーザーデータ収集フライホイール

**日付**: 2026-05-24  
**前回**: `20260524_discover_candidates.md`（発掘ツール整備・candidates.json 72件投入）  
**目的**: 自前クリップラベリング 8→25-30 本を主軸にする計画を改め、段階リリース方針に転換する

---

## 方針転換の背景と妥当性評価

### 旧計画の問題

自前手作業ラベリングは 1 clip 30-60 分かかり、25-30 clip 到達まで 15-22 時間の純作業が必要。
ボトルネックが開発者自身の手作業になっており、スケールしない。

### 新方針

1. **まず手動スコア記録のみを出荷可能状態にする**（v0.9）
2. **ユーザーが記録した動画＋ラリー区間ラベルを収集**して ML モデルを作る（v1.0〜v1.1）

メリット:
- **データの多様性**: コート・カメラ角度・球種・レベルが自前ラベリングと比べて桁違い
- **スケール**: ユーザー増加に比例してデータが増える human-in-the-loop
- **工数削減**: 開発者がクリップを手作業ラベリングし続ける必要がなくなる

### 重大な条件（設計に織り込んだ点）

現状の `PointRecord`（`src/types/point.ts`）は動画内時刻として `videoTimestamp`（単一スカラー、optional）しか持たず、
ML が必要とするラリーの**区間**（startSec〜endSec）を保持できない。  
さらに主要記録画面 `app/session/[id]/log.tsx` は `videoTimestamp` を一切セットしない。  
`RallyWindow.startSec/endSec`（`rallySegment.ts:56`）は `auto-score.tsx` で捨てられていた。

→ 区間捕捉を記録 UX に織り込むことが版1の中核。これを v1.0 として実装した。

---

## 実装内容

### Phase v0.9 — 出荷整備（dead code 除去）

| ファイル | 変更内容 |
|---|---|
| `src/components/point/PointLoggerForm.tsx` | **削除**（アプリ内どこからも import されていない dead code） |
| `src/components/point/index.ts` | `PointLoggerForm` の export 行を削除 |
| `app/(tabs)/settings.tsx` | 「通知」「単位 / 表示」の hardcoded プレースホルダー行を削除（操作不能・固定値表示のみ） |

### Phase v1.0 — ラリー区間捕捉

**データモデル**

```typescript
// src/types/point.ts — PointRecord に追加
rallyStartSec?: number;  // ラリー開始時刻（動画内秒）
rallyEndSec?: number;    // ラリー終了時刻（動画内秒）
```

```typescript
// src/types/scoring.ts — AutoPointCandidate に追加
rallyStartSec?: number;
rallyEndSec?: number;
```

**video.tsx — 2タップ区間捕捉**

`handleMarkRallyStart()` で開始時刻を state に保持し、「得点/失点」タップ時に区間として `PointRecord` に書き込む。  
開始未マーク時は従来どおり瞬間記録にフォールバック（後方互換）。  
タイムラインを点マーカーから**区間バー**表示に拡張（`intervalBar` スタイル追加）。

```
[▶ ラリー開始をマーク] ← 新ボタン（マーク済みなら開始時刻表示）
[　　得点　] [　失点　]  ← 既存（押下で区間確定）
```

**auto-score.tsx — RallyWindow 区間の破棄を停止**

```typescript
// Before: window が捨てられていた
const allCandidates = results.flatMap(({ result }) => proposeCandidates(...))

// After: window.startSec/endSec を候補に付与
const allCandidates = results.flatMap(({ window: win, result }) =>
  proposeCandidates(...).map((c) => ({ ...c, rallyStartSec: win.startSec, rallyEndSec: win.endSec }))
)
```

確定時も `handleConfirmSheetCommit` が `rallyStartSec`/`rallyEndSec` を `PointRecord` に書き込む。

**log.tsx — 区間表示と確認導線**

- `rallyStartSec/rallyEndSec` がある場合は `00:42〜00:58` 形式で表示
- ジャンプボタンが「▶ ラリー区間を確認」に変わり、`rallyStartSec` にシーク

### Phase v1.1 — 学習用データエクスポート（収集ステップ1）

**`src/services/export/trainingLabel.ts`（新規）**

`rallyStartSec/rallyEndSec` を持つポイントを eval pipeline の rally-interval スキーマに変換する:

```json
{
  "clipId": "user-<sessionId>",
  "sourceVideoUri": "...",
  "sessionTitle": "...",
  "recordedAt": "2026-05-24T...",
  "rallies": [
    { "startSec": 42.5, "endSec": 58.3, "server": null, "winner": null, "endReason": null }
  ]
}
```

`validate-rally-labels.py` が受理する形式と同一スキーマ。

**`src/components/common/ExportMenu.tsx` — 新規ボタン追加**

- 「ラリーラベル (JSON)」: `rallyStartSec/rallyEndSec` を持つポイントが1件以上ある場合のみ表示
- 「動画を共有」: `session.videoUri` がある場合に表示（`expo-sharing` で直接共有）

ユーザーは「ラリーラベル (JSON)」と「動画を共有」を順番に押して、両方を送ることでラベル付きクリップを提供できる。

---

## 後続マイルストーン（本サイクル out of scope）

| フェーズ | 内容 |
|---|---|
| 収集ステップ2 | クラウド収集基盤（greenfield: ストレージ + API + 同意フロー）。現行は完全オンデバイス |
| ML 再訓練ループ | 収集データ → rasterize.py → Modal GPU 訓練（GRU v3, fps=5, epochs=200）→ eval:score → ゲート 0.85 |
| on-device swap | ゲート通過後: TFLite/Core ML export → `rallySegment.ts` の blob 実装を swap |

自前 25-30 clip ラベリング（discover→screen→add-new-clip）は収集が回り始めるまでの保険として残す。

---

## 検証

```bash
npm run type-check  # エラー 0
npm run lint        # エラー 0（warnings は既存 eval スクリプトのみ）
```

iOS シミュレータでの確認事項（次セッション）:
- 動画タブで「ラリー開始をマーク」→ 動画再生 → 「得点」で区間捕捉できること
- ログタブで `00:42〜00:58` 形式の区間表示と「▶ ラリー区間を確認」ジャンプが動作すること
- ExportMenu に「ラリーラベル (JSON)」「動画を共有」が出現し、JSONが rally-interval スキーマに準拠すること

---

## 変更ファイル

```
src/types/point.ts              rallyStartSec/rallyEndSec フィールド追加
src/types/scoring.ts            AutoPointCandidate に同フィールド追加
src/components/point/index.ts   PointLoggerForm export 削除
src/components/point/           PointLoggerForm.tsx 削除
app/(tabs)/settings.tsx         通知・単位/表示プレースホルダー行削除
app/session/[id]/video.tsx      ラリー開始マーク・区間捕捉・タイムライン区間バー
app/session/[id]/auto-score.tsx RallyWindow startSec/endSec を保持
app/session/[id]/log.tsx        区間表示・確認ジャンプ
src/services/export/trainingLabel.ts  訓練フォーマット JSON ビルダー（新規）
src/services/export/index.ts    trainingLabel エクスポート追加
src/components/common/ExportMenu.tsx  ラリーラベル(JSON)・動画共有ボタン追加
```
