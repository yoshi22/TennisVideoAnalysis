# Phase 6 開発ログ: 動画プレーヤー / 自動ラリー / 試合スコア / エクスポート / オンボーディング / 競合ギャップ補完

**日付**: 2026-05-17  
**担当**: Claude Code (ロジック・テスト・アーキテクチャ) + Codex (UI)  
**対象バージョン**: CourtLens v1.x (Expo SDK 54)

---

## 概要

Phase 5 までで CV パイプライン（コート較正・ボール追跡・自動採点）が完成したが、  
以下の機能ギャップを解消する 8 ステージの実装を行った:

1. 動画プレーヤー + タイムスタンプ連携
2. 自動ラリー区間検出
3. 試合スコアエンジン（ゲーム / セット / マッチ）
4. CSV / Markdown エクスポート + iOS 共有シート
5. Phase 3-5 に対応したオンボーディング拡張
6. 競合調査 + サーブ速度推定の実装（P0 ギャップ補完）
7. 撮影ガイド改訂（CV 機能向け追加条件）
8. 開発ログ（本ファイル）

---

## Stage 0: Phase 3-5 開発ログ

`docs/development-logs/20260517_phase3_5_court_cv.md` を作成。  
Phase 3（DLT ホモグラフィ）・Phase 4（古典的ボール追跡）・Phase 5（自動採点 SM）の全詳細を記録。

---

## Stage 1: 動画プレーヤー + タイムスタンプ連携

### 1-1. VideoPlayer コンポーネント（Claude）

- **`src/components/video/VideoPlayer.tsx`** 新規
  - `expo-video` の `useVideoPlayer` / `VideoView` / `useEvent` を内包
  - `VideoPlayerRef`: `seekTo(sec)` / `play()` / `pause()` / `getCurrentTime()` / `getDuration()` を `useImperativeHandle` で公開
  - `timeUpdateEventInterval = 0.5` でリアルタイム時刻更新
  - `TimeUpdateEventPayload` の全フィールド（`currentTime`, `currentLiveTimestamp`, `currentOffsetFromLive`, `bufferedPosition`）を初期値として渡す必要があることを確認
  - カスタムコントロール: 再生/一時停止ボタン + プログレスバー + 時刻表示

- **`src/services/video/playerController.ts`** 新規
  - モジュールレベル変数 `pendingSeek` でクロスタブシーク座標を保持
  - `setPendingSeek(sessionId, timeSec)` / `consumePendingSeek(sessionId)` / `clearPendingSeek()`
  - タブ切替時でも VideoPlayer がマウントされた瞬間に正しいシークを再現

### 1-2. Video タブ UI（Codex）

- **`app/session/[id]/video.tsx`** 新規
  - `VideoPlayer` フル幅表示
  - タイムラインマーカー: ポイントの `videoTimestamp` を `△` マーカーで可視化（won=primary / lost=danger）
  - マーカー・ポイント一覧行タップで `seekTo(videoTimestamp)` を呼び出し
  - `useFocusEffect` + `consumePendingSeek` でタブフォーカス時に pending シークを消費

- **`app/session/[id]/_layout.tsx`** 更新
  - Log / Video / Court / Report の 4 タブ構成に変更

---

## Stage 2: 自動ラリー区間検出

### 2-1. ロジック（Claude）

- **`src/services/ball/autoSegment.ts`** 新規
  - `detectRallyWindows(opts)`: 全動画を ~3fps でスキャン、各フレームでブロブ検出
  - 検出タイムスタンプをマージ: `gapToleranceSec = 0.5`、`minDurationSec = 2`、`maxDurationSec = 30`
  - `confidence` = 区間内検出フレーム数 / 総フレーム数（0〜1）
  - `AbortSignal` 対応でキャンセル可能
  - `analyzeRallyBatch(windows, opts)`: 複数ウィンドウを順次 `analyzeRally` に投入し進捗をマッピング

### 2-2. UI（Codex）

- `app/session/[id]/ball-trace.tsx` に「自動分割」ボタン追加
  - 検出ウィンドウをスクロール可能なチップ一覧で表示
  - タップで `startSec` / `endSec` に反映
- `app/session/[id]/auto-score.tsx` に「自動ラリー一括採点」ボタン追加

### 2-3. テスト（Claude）

- **`__tests__/services/ball/autoSegment.test.ts`** 7 ケース
  - 空入力、単一クラスタ、2 クラスタ（ギャップ超過）、ギャップ許容でマージ、最短長フィルタ、最長クランプ、3 クラスタ

---

## Stage 3: 試合スコアエンジン

### 3-1. 型定義（Claude）

- **`src/types/matchScore.ts`** 新規
  ```ts
  TennisPointScore = '0' | '15' | '30' | '40' | 'AD'
  GameScore, SetScore, MatchScore, MatchScoreConfig
  HARD_TENNIS_CONFIG, SOFT_TENNIS_CONFIG
  ```

### 3-2. ステートマシン（Claude）

- **`src/services/scoring/matchState.ts`** 新規
  - `initMatchScore(config)`: ゼロ状態から初期化
  - `applyPoint(state, outcome)`: 純関数、副作用なし
    - 硬式: `HARD_SEQUENCE = ['0','15','30','40']` → Deuce → AD → Game
    - ソフト: 0 → 1 → 2 → 3 → Deuce(3-3) → 2 点差で Game
    - タイブレーク: 6-6 で発火、先取 7 点かつ 2 点差
    - セット: 硬式 6 ゲーム（6-6 はタイブレーク）、ソフト 4 ゲーム
    - 試合: `setsToWin` 到達で `matchWinner` を確定、以降操作不能
  - `computeMatchScore(points[], sport)`: ポイント配列全走査で現状を再算出
  - `formatGameScore(game)`: `"40 - 30"` / `"AD - 40"` / `"6 - 5"` 形式
  - `formatSetScoreLine(sets)`: `"6-4, 3-2"` 形式

### 3-3. UI（Codex）

- **`src/components/scoring/MatchScoreboard.tsx`** 新規
  - `formatGameScore` / `formatSetScoreLine` を使ったスコアボード
  - 試合終了時に勝者テキストを表示
- `app/session/[id]/log.tsx` ヘッダーに統合

### 3-4. テスト（Claude）

- **`__tests__/services/scoring/matchState.test.ts`** 20+ ケース
  - 硬式: 4 点 → 1 ゲーム、デュース、AD 往復、タイブレーク（6-6 TR、要 2 点差）、セット 6-0 / 7-5 / タイブレーク確定、試合終了後ロック
  - ソフト: 4 点ゲーム、3-3 デュース、試合 3 セット
  - computeMatchScore 初期状態チェック

---

## Stage 4: エクスポート / 共有

### 4-1. CSV エクスポート（Claude）

- **`src/services/export/csv.ts`**
  - UTF-8 BOM 付きで Excel 互換
  - `\r\n` 改行で Windows 対応
  - 列: `timestamp, outcome, shotType, resultReason, rallyCount, serveResult, shotLocationX/Y, targetLocationX/Y, videoTimestamp, note`
  - カンマ・ダブルクォート・改行のエスケープ処理

- **`__tests__/services/export/csv.test.ts`** 4 ケース
  - 空セッション（BOM + ヘッダーのみ）、1 データ行、カンマエスケープ、省略フィールドの空白処理

### 4-2. Markdown レポート（Claude）

- **`src/services/export/markdown.ts`**
  - セッション基本情報 / 試合経過 / ショット別集計テーブル / 弱点リスト / コーチングコメント
  - `WeaknessPattern` 文字列リテラルユニオンを日本語ラベルにマッピング

### 4-3. 共有（Claude）

- **`src/services/export/share.ts`**
  - `expo-file-system` 新 API: `File`, `Paths` を使用（`new File(path).write()` 形式）
  - `expo-sharing` の `Sharing.shareAsync(filePath)` で iOS 共有シートを表示

### 4-4. UI（Codex）

- **`src/components/common/ExportMenu.tsx`**: CSV / Markdown / キャンセルのモーダルシート
- `app/session/[id]/report.tsx` 右上に「エクスポート」ボタン

---

## Stage 5: オンボーディング拡張（Codex）

- **`src/components/onboarding/MockCalibrationCard.tsx`**: SVG コート 4 隅タップモック
- **`src/components/onboarding/MockAutoScoreCard.tsx`**: 採点候補カードモック
- **`app/onboarding.tsx`**: 2 ステップ追加（較正 / 自動採点）、計 7 ステップ

### `onboardingVersion` 管理（Claude）

- **`src/stores/onboardingStore.ts`** 更新
  - `CURRENT_ONBOARDING_VERSION = 2` を定数管理
  - `needsVersionUpdate()`: 古いバージョンのユーザーに差分ステップを案内
  - `markVersionCurrent()`: 新規ステップ確認済みをマーク

---

## Stage 6: 競合調査 + P0 ギャップ補完

### 6-1. 競合調査（general-purpose エージェント）

**調査対象**: SwingVision / Baseline Vision / Zenniz / Track Tennis / Hudl Replay  
**調査方法**: WebSearch + WebFetch（App Store レビュー / r/tennis / 公式サイト）

**競合との差分 TOP 3 (P0)**:

| 機能 | 主要競合 | CourtLens |
|---|---|---|
| 電子線審（In/Out 判定） | SwingVision, Baseline Vision, Zenniz | ❌ なし（bounceDetect.inBounds は実装済み、精度課題あり） |
| ショット速度測定 | SwingVision, PlaySight, Baseline Vision | ✅ Phase 6 で実装 |
| ショット配球ヒートマップ | SwingVision, Baseline Vision | ✅ 既存（CourtHeatmap コンポーネント） |

**CourtLens の差別化ポイント**:
- 完全オフライン・サブスクリプション不要
- ハード・ソフトテニス両対応
- オンデバイス姿勢推定（MoveNet Lightning）
- オープンソース DLT ホモグラフィ

### 6-2. P0-B 実装: サーブ速度推定（Claude）

- **`src/services/ball/serveSpeed.ts`** 新規
  - 連続 `BallDetection` 間の変位 → ホモグラフィでコート座標 → 実距離（ITF 規格: 23.77m × 8.23m）→ m/s → km/h
  - `computeSpeedSamples(trajectory, calibration)`: 全インターバルの速度サンプル列
  - `computePeakSpeedKmh(trajectory, calibration)`: ピーク速度（> 300 km/h は計測ノイズとして除外）
  - `analyzeRally()` の戻り値 `RallyAnalysis` に `peakSpeedKmh: number | null` を追加
  - `app/session/[id]/ball-trace.tsx` の解析結果セクションに「ピーク速度: X km/h」表示

- **`__tests__/services/ball/serveSpeed.test.ts`** 8 ケース
  - 空・1 点 → empty、幅変位 → 29.6 km/h、長さ変位 → 85.6 km/h、中点タイムスタンプ、ピーク取得、300+ 破棄

---

## Stage 7: 撮影ガイド改訂（Stage 6 情報を反映）

- **`app/recording-guide.tsx`** 更新
  - 「基本撮影条件」6 項目（従来通り）
  - 「CV 機能（コート較正・ボール追跡・速度推定）」5 項目を追加:
    - コート較正は最初に必ず実施
    - ボール視認解像度（Full HD 以上）
    - コート/ボールのコントラスト
    - カメラ固定（フレーム差分アルゴリズム前提）
    - 速度推定の精度と較正依存性

---

## Stage 8: ヘルプ・設定画面（Codex）

- **`app/help.tsx`** 新規 — アコーディオン形式 FAQ（8 項目）
- **`app/(tabs)/settings.tsx`** 更新 — ヘルプリンク追加

---

## 追加テスト一覧（Phase 6）

| ファイル | カバー範囲 | ケース数 |
|---|---|---|
| `__tests__/services/ball/autoSegment.test.ts` | 区間マージロジック | 7 |
| `__tests__/services/scoring/matchState.test.ts` | 硬式/ソフト試合スコア SM | 20+ |
| `__tests__/services/export/csv.test.ts` | CSV 生成・エスケープ | 4 |
| `__tests__/services/ball/serveSpeed.test.ts` | 速度計算・ピーク・破棄 | 8 |
| **合計（Phase 1-6）** | | **58** |

---

## 主要ファイル一覧（Phase 6 新規・更新）

### 新規

| ファイル | 役割 |
|---|---|
| `src/components/video/VideoPlayer.tsx` | expo-video ラッパーコンポーネント |
| `src/services/video/playerController.ts` | クロスタブシーク座標ブリッジ |
| `app/session/[id]/video.tsx` | 動画タブ（タイムライン + ポイントリスト） |
| `src/services/ball/autoSegment.ts` | ラリー区間自動検出 + バッチ解析 |
| `src/services/ball/serveSpeed.ts` | ボール速度推定（ホモグラフィ + ITF 寸法） |
| `src/types/matchScore.ts` | 試合スコア型定義 |
| `src/services/scoring/matchState.ts` | 試合スコアステートマシン |
| `src/components/scoring/MatchScoreboard.tsx` | スコアボード UI |
| `src/services/export/csv.ts` | CSV ビルダー（BOM / エスケープ） |
| `src/services/export/markdown.ts` | Markdown レポートビルダー |
| `src/services/export/share.ts` | expo-file-system + expo-sharing 統合 |
| `src/components/common/ExportMenu.tsx` | エクスポートモーダルシート |
| `src/components/onboarding/MockCalibrationCard.tsx` | 較正 UI モック |
| `src/components/onboarding/MockAutoScoreCard.tsx` | 自動採点候補カードモック |
| `app/help.tsx` | FAQ ヘルプ画面 |
| `docs/development-logs/20260517_phase3_5_court_cv.md` | Phase 3-5 開発ログ |

### 更新

| ファイル | 変更内容 |
|---|---|
| `app/session/[id]/_layout.tsx` | 4 タブ構成（Log / Video / Court / Report） |
| `app/session/[id]/ball-trace.tsx` | 自動分割 + ピーク速度表示 |
| `app/session/[id]/auto-score.tsx` | 自動ラリー一括採点 |
| `app/session/[id]/log.tsx` | MatchScoreboard 統合、動画ジャンプリンク |
| `app/session/[id]/report.tsx` | エクスポートボタン |
| `src/services/ball/index.ts` | `peakSpeedKmh` を RallyAnalysis に追加、serve speed エクスポート |
| `app/onboarding.tsx` | 較正・自動採点ステップ追加（計 7 ステップ） |
| `app/recording-guide.tsx` | CV 機能向け撮影条件 5 項目追加 |
| `app/(tabs)/settings.tsx` | ヘルプリンク追加 |
| `src/stores/onboardingStore.ts` | `onboardingVersion` 管理 |
| `src/types/index.ts` | matchScore 型エクスポート追加 |
| `src/services/scoring/index.ts` | matchState 関数エクスポート追加 |

---

## 既知の制約（Phase 6 追加分）

1. **速度推定精度**: コート較正の 4 隅指定精度に強く依存。較正が不正確だと誤差が大きくなる。
2. **In/Out 判定精度**: `bounceDetect.inBounds` はホモグラフィベースの近似判定。電子線審（SwingVision 等）レベルの精度はない。
3. **ハイライト動画切り出し**: `expo-video` に trim API がないため、論理的ハイライト（タイムスタンプリスト）の提供にとどまる。
4. **エクスポートキャッシュ**: 一時ファイルは iOS のキャッシュに書き込む。セッション終了後は OS が自動削除。
5. **マルチセッション統計**: 競合の P1-C（試合履歴トレンド）は未実装。将来の優先候補。

---

## 動作確認手順

```bash
# 静的チェック（全 0 エラー確認済み）
npm run type-check
npm run lint
npm test  # 58 tests passed

# 実機確認
npx expo run:ios
```

### 確認シナリオ

- セッションの「動画」タブで VideoPlayer 再生・シーク
- ポイント一覧からタイムラインマーカーをタップして対応時刻へジャンプ
- ログ画面の「▶ 動画で確認」ボタン → 動画タブで自動シーク
- ball-trace: 「自動分割」で複数 RallyWindow チップを確認、タップで範囲設定
- ball-trace: 「解析」実行後にピーク速度が表示される（コート較正済み時）
- auto-score: 「自動ラリー一括採点」で複数候補が並ぶ
- log タブ: スコアボードがポイント追加のたびに即時更新
- report タブ: エクスポートアイコン → CSV / Markdown の共有シートが立ち上がる
- 設定 → 使い方ガイドで FAQ 表示
- オンボーディング: 較正・自動採点の新規ステップが表示
- 撮影ガイド: CV 機能向け 5 項目が「CV 機能」セクションに表示
