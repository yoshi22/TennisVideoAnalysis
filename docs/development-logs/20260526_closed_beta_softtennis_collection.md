# クローズドベータ 軟式テニス データ収集 + Video タブ強化

**日付**: 2026-05-26  
**担当**: Claude (TS/RN クライアント), codex (Python eval + クロスレビュー)  
**ベースコミット**: `385f624`（v1.1 エクスポート収集まで実装済み）

---

## 背景・目的

v1（手動スコア / ラリー区間捕捉 / エクスポート）が完成し、次フェーズは  
**「実利用データを集めてモデルを更新するループ」** を回すこと。

ユーザーの軟式テニスサークルメンバーを対象にクローズドベータを実施し、  
**カテゴリ別動画＋ラベル＋メタデータ**をクラウドフォルダへ回収する。  
ベータ参加者にも価値を提供するため、Video タブで「動画 + スコア + 配球の時系列レビュー」を強化する。

---

## 実装サマリ

### Batch A — ベータ基盤 (`bd840a2`, `2072efb`)

| ファイル | 変更内容 |
|---|---|
| `src/types/submission.ts` | `SubmissionManifest` スキーマ（single source of truth） |
| `src/stores/betaStore.ts` | 匿名参加者 ID + 同意バージョン管理（persist: `courtlens-beta`） |
| `app/beta-consent.tsx` | 同意画面（収集物説明・用途・オプトアウト） |
| `app/(tabs)/settings.tsx` | クローズドベータセクション追加 |
| `app/recording-guide.tsx` | 試合 / サーブ練習カテゴリ別撮影ガイド |
| `__tests__/stores/betaStore.test.ts` | 4 tests |

**codex レビュー #1 での修正**:
- `hasValidConsent` を `consentVersion` + `consentAcceptedAt` 両方チェックに強化
- 「匿名 UUID」→「参加者 ID」（実装は NanoID 互換、UUID ではない）
- 「位置情報は収集しません」削除（動画ファイルに GPS が含まれうる）
- オプトアウト文言を明確化（過去提出データは保持される旨）

### Batch B — 提出バンドル + アップロード + UI (`55c8557`, `014bac6`)

| ファイル | 変更内容 |
|---|---|
| `src/services/submission/manifest.ts` | `buildSubmissionManifest()` — null ガード・rally/points 写像 |
| `src/services/submission/uploader.ts` | `SubmissionUploader` interface + `createUploader()` |
| `src/services/submission/supabaseUploader.ts` | `expo-file-system/legacy` `uploadAsync` で大容量動画 PUT |
| `src/components/submission/SubmissionSheet.tsx` | Bottom sheet: 同意ガード・未設定ガード・プレビュー・進捗バー |
| `app/session/[id]/report.tsx` | ヘッダに `cloud-upload-outline` ボタン追加 |
| `app.json` | `expo.extra.submission` スキャフォルド（url/anonKey 空 = createUploader null = 安全） |
| `__tests__/services/submission/manifest.test.ts` | 12 tests |

**設計上の重要ポイント**:
- `serveTraining` は rally 区間なしでも confirmed point ≥ 1 で提出可
- `sha256` はクライアントで空文字 → ingestion スクリプト（Batch D）が hashlib で算出
- Supabase Storage: `PUT {url}/storage/v1/object/{bucket}/{participantId}/{submissionId}/video.mp4`
- `x-upsert: true` で同一 submissionId への再試行を上書き可能

**codex レビュー #2 での修正**:
- `SubmissionSheet` で `useRef` を使い manifest を mount 時 1 回だけ計算（submissionId 安定化）
- `isValidRallyInterval` に `startSec >= 0` を追加（`validate-rally-labels.py` の制約と整合）
- `submission.ts` に ingestion 変換コントラクトをコメントで明記

### Batch C — Video タブ強化 (`3755bf3`, `058d194`)

対象ファイル: `app/session/[id]/video.tsx`

**変更内容**:
1. タイムラインマーカー / インターバルバー / リスト行タップ → `handleSelectPoint` で選択
2. 詳細カード（タイムライン直下）:
   - 「動画内スコア」（confirmed + videoTimestamp 付きポイントの累積）
   - 得点/失点 チップ + draft バッジ（draft ポイントでも result がわかる）
   - 配球ミニコート（`CourtChart` width=100 height=160）
   - 前/次ラリーナビ + N/total インジケータ
3. **スコア表示の draft 除外バグ修正**: `score` useMemo を `isConfirmed` フィルタに統一
4. draft マーカーは opacity 0.4 で視覚的に区別

**codex レビュー #3 での修正**:
- カードのスコアラベルを「累積スコア」→「動画内スコア」に変更（videoTimestamp なし confirmed は含まれないため）
- `selectedPointIndex === -1` ガードを prev/next handler に追加

---

## プライバシー設計

| 収集項目 | 説明 |
|---|---|
| 動画ファイル | セッションに紐づけた動画。ラリー区間の検出モデル改善に使用 |
| スコア・ショットラベル | 得失点・ショット種別・結果理由・ラリー本数 |
| 配球・着地位置 | コート上のショット位置（0〜1 正規化座標）・コート較正データ |
| 参加者 ID・アプリ情報 | ランダム生成された参加者 ID（端末識別不可）とアプリバージョン |

- 収集目的: **解析モデルの改善のみ**。第三者提供・販売なし。
- 同意は `CONSENT_VERSION = 1` で管理。文言変更時は version を bump。
- オプトアウト: 設定画面から随時可能。以降の提出が停止（過去データは保持）。
- `participantId` は NanoID 互換 21 文字ランダム文字列（UUID 形式ではない）。

---

## SubmissionManifest スキーマ

```ts
{
  schemaVersion: 1,
  submissionId: string,       // generateId() — upload attempt ごとに固定
  participantId: string,       // 匿名参加者 ID
  appVersion: string,          // Constants.expoConfig?.version
  createdAt: string,           // ISO 8601
  sport: 'tennis' | 'softTennis',
  sessionType: SessionType,    // 主に 'match' | 'serveTraining'
  matchFormat: MatchFormat,
  position?: SoftTennisPosition,  // 軟式専用
  video: { filename, durationSec?, fps: 30, sha256: '' },  // sha256 は ingestion で補完
  courtCalibration?: CourtCalibration,
  rallies: { startSec, endSec }[],     // scoreless — eval pipeline (training pool)
  points: SubmissionPointLabel[],      // 全ラベル (training only, NOT scoreless test)
  consent: { version: number, acceptedAt: string }
}
```

**ingestion 変換（Batch D）**:
- `submissionId` → `videoId` (prefix: `user-{submissionId}`)
- Storage path → `sourceUrl`
- `video.sha256 ''` → hashlib で算出 → `sourceSha256`
- `video.durationSec` → `clipDurationSec`; `clipOffsetSec = 0`
- `rallies` → `TrainingRally[]` (server/winner/endReason = null)
- `points` → `tactical/<clipId>.json`（training 専用）

---

## 検証結果

```
npm run type-check  → 0 errors
npm run lint        → 0 errors
npm test            → 133 tests passed (20 test suites)
```

新規テスト:
- `__tests__/stores/betaStore.test.ts`: 4 tests
- `__tests__/services/submission/manifest.test.ts`: 12 tests

---

## 未完了 / 残課題

### Batch D（codex 担当 — 別途依頼）

`scripts/eval/ingest-user-submission.py`:
- 入力: ダウンロード済みバンドル群 `{participantId}/{submissionId}/video.mp4 + manifest.json`
- manifest スキーマ検証 → sha256 算出 → candidates.json 追記
- `labels/<clipId>_DRAFT.json`（scoreless ラリー, eval 互換）
- `tactical/<clipId>.json`（全ラベル, training 専用）

`eval/datasets/closed-beta-soft-v1/`:
- README.md（軟式クローズドベータ由来・同意取得済み・training 専用・held-out test には使わない）
- `candidates.json` 雛形（`fixed-camera-v2` スキーマ準拠）
- `videos/ clips/ labels/ tactical/`（動画系は .gitignore, labels は commit 対象）

### 手動 UI 検証（未実施）

シミュレータで以下を確認すること:
1. 軟式試合 + 動画 → ラリー区間マーク → 得点/失点 → 設定でベータ同意 → レポートから SubmissionSheet → アップロード成功
2. 軟式サーブ練習 → videoTimestamp + serveResult + 着地 → 提出（rally なしでも成立）
3. Video タブ → マーカータップ → 詳細カードに累積スコア・配球ミニコートが表示 → 前後ナビで動画移動

### 既知の残課題（スコープ外）

- `court.tsx` / `SessionCard.tsx` / `index.tsx` の draft 除外統一（別途フォローアップ）
- アップロードのリトライ/バックグラウンド再開（MVP は手動再試行）
- サーバ側集計ダッシュボード（バケット目視 + ingestion スクリプトで代替）

---

## Supabase セットアップ手順（ユーザー作業）

1. Supabase プロジェクト作成
2. Storage バケット `beta-submissions` を作成
3. RLS ポリシー: anon ユーザーが `{participantId}/{submissionId}/*` に INSERT/UPDATE できるよう設定  
   （`x-upsert: true` を使うため UPDATE も必要）
4. URL と anon key を取得
5. `app.json` の `expo.extra.submission.url` と `expo.extra.submission.anonKey` に設定

設定が空の間は `createUploader()` が null を返し、SubmissionSheet は「回収先未設定」を表示（クラッシュなし）。
