# Phase 7 開発ログ: Codex リファクタリング + GitHub Push + TestFlight リリース

**日付**: 2026-05-17  
**担当**: Claude Code (コミット / リリース管理) + Codex (リファクタリング)  
**対象バージョン**: CourtLens v1.1.0 (Expo SDK 54)

---

## 概要

Phase 1-6 で実装した全機能をリリース可能な状態に整備した。

1. **v1.1.0 バージョン bump** — app.json の version を 1.0.0 → 1.1.0 に更新
2. **Phase 1-6 全変更を一括コミット** — 106 files, 10,506 insertions
3. **Codex によるリファクタリング** — 重複コードを共通ユーティリティ / フックに集約
4. **GitHub push** — `origin/master` に push 完了（コミット `df7fe48`）
5. **EAS ビルド + TestFlight** — `eas build --platform ios --profile production` で v1.1.0 をビルド

---

## Phase 1-6 コミット（feat: v1.1.0）

**コミットハッシュ**: `3a99fa3`

### 含まれる変更サマリー

| Phase | 内容 |
|---|---|
| Phase 1 | Refined Court デザインシステム、オンボーディング、撮影ガイド |
| Phase 2 | MoveNet Lightning によるオンデバイス姿勢推定フォーム分析 |
| Phase 3 | DLT ホモグラフィによるコート較正（4 隅タップ UI） |
| Phase 4 | フレーム差分 → ブロブ検出 → 貪欲トラッカー → バウンド検出 |
| Phase 5 | 決定論的自動採点ステートマシン（確認 UI 必須ガード） |
| Phase 6 | 動画プレーヤー + タイムスタンプジャンプ、自動ラリー区間検出、試合スコアエンジン、CSV/Markdown エクスポート、サーブ速度推定、撮影ガイド拡張 |

**統計**: 106 files changed, 10,506 insertions, 42 deletions  
**テスト**: 58 passed / 8 suites, 0 type errors, 0 lint errors

---

## Codex リファクタリング

**コミットハッシュ**: `df7fe48`

### 抽出した共通コード

| 新規ファイル | 役割 |
|---|---|
| `src/utils/sessionParams.ts` | `getParamId(id)` — URL パラメータ正規化 |
| `src/utils/formatTime.ts` | `formatSeconds(s)` — 時刻フォーマット（`formatVideoTime` と統一） |
| `src/hooks/useSession.ts` | `useSession()` — `useLocalSearchParams` + sessionStore lookup を 1 行に |
| `src/hooks/index.ts` | バレルエクスポート |

### リファクタリング適用画面

- `app/session/[id]/video.tsx`
- `app/session/[id]/ball-trace.tsx`
- `app/session/[id]/auto-score.tsx`
- `app/session/[id]/calibration.tsx`
- `app/session/[id]/log.tsx`
- `app/session/[id]/report.tsx`
- `app/session/[id]/court.tsx`
- `app/session/[id]/_layout.tsx`
- `app/form-analysis/[id].tsx`

**結果**: 13 files changed, 49 insertions, 92 deletions（net -43 行）  
リファクタリング後も type-check 0 エラー、lint 0 エラー、58 tests 全通過を確認。

---

## GitHub Push

**リポジトリ**: `https://github.com/yoshi22/TennisVideoAnalysis.git`  
**ブランチ**: `master`  
**プッシュ範囲**: `de90178..df7fe48`

HTTP push 時に大容量ペイロード（約 10MB+）で HTTP 400 が発生したため、  
`git config http.postBuffer 524288000` で送信バッファを 500MB に拡張して解決。

---

## EAS ビルド + TestFlight

**プロファイル**: `production`（`eas.json` の `build.production`）  
**EAS プロジェクト ID**: `a9495214-cd2f-40ae-a32e-ba7e8d517b58`  
**バンドル ID**: `com.courtlens.app`  
**アカウント**: `yoshi22`

```bash
# ビルドトリガー
eas build --platform ios --profile production --non-interactive

# TestFlight 提出
eas submit --platform ios --profile production --latest
```

ビルド完了後、App Store Connect → TestFlight でテスターへの配信が可能になる。

---

## v1.1.0 で追加・変更された主要機能

### ユーザーに見える変更

| 機能 | 説明 |
|---|---|
| 動画タブ | セッション内に「動画」タブを追加。タイムラインマーカーからポイント時刻へジャンプ |
| 試合スコアボード | ログタブ上部に現在のゲーム / セット / 試合スコアを常時表示 |
| ボール速度表示 | ボール軌跡解析後にピーク速度 (km/h) を表示 |
| エクスポート | レポートタブから CSV / Markdown を iOS 共有シートで送信 |
| 自動ラリー区間検出 | ボール軌跡画面で動画を自動スキャン、ラリー区間をチップで提示 |
| オンボーディング拡張 | コート較正・自動採点の操作を説明する 2 ステップを追加（計 7 ステップ） |
| 撮影ガイド拡張 | CV 機能向けの撮影条件（較正必須、カメラ固定等）5 項目を追加 |
| ヘルプ画面 | 設定タブから「使い方ガイド」（アコーディオン FAQ）を表示 |

### 内部変更

- `useSession()` フックで全セッション画面の ID 取得を統一
- `formatSeconds()` / `getParamId()` を共通ユーティリティに集約
- `RallyAnalysis` に `peakSpeedKmh` フィールドを追加
- `onboardingVersion` 管理で新規ステップの差分表示に対応

---

## 既知の制約・今後の課題

1. **電子線審（In/Out 自動判定）**: 競合（SwingVision 等）の P0 機能。現状は `bounceDetect.inBounds` で近似判定するが精度は撮影条件依存。将来は ML モデルで補強予定。
2. **マルチセッション統計トレンド**: 複数セッションにわたる統計グラフは未実装（競合 P1 ギャップ）。
3. **ハイライト動画切り出し**: `expo-video` に trim API がないため論理的ハイライト（タイムスタンプリスト）にとどまる。SDK 56 以降で `expo-video` の seek/thumbnail API 移行と併せて検討。
4. **`expo-video-thumbnails` 廃止予定**: SDK 56 で廃止予定（Phase 3-5 ログ既記載）。
