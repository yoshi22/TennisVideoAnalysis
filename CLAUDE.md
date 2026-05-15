# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## プロジェクト

**CourtLens** — 硬式テニス・ソフトテニス向け動画分析 MVP。試合・練習セッションにポイント記録を紐づけ、スタッツとコーチングコメントを生成する React Native アプリ。

## コマンド

```bash
npm run type-check        # TypeScript 型チェック（エラー 0 が必須）
npm run lint              # ESLint（エラー 0 が必須）
npm test                  # Jest（watchman 無効化済み）
npm test -- --testPathPattern=ManualAnalyzer  # 特定テストのみ実行

npx prettier --write "path/to/file.tsx"  # ファイル単体をフォーマット
```

変更後は必ず `npm run type-check && npm run lint` を通すこと。Prettier エラーは lint で検出されるため、ファイルを書いたら都度 `npx prettier --write` を実行する。

## アーキテクチャ

### ルーティング（Expo Router / ファイルベース）

```
app/
  _layout.tsx              # ルートレイアウト: フォントロード + SplashScreen + ThemeProvider
  (tabs)/
    _layout.tsx            # CustomTabBar を差し込む 5 タブ定義
    index.tsx              # ホーム
    history.tsx            # 履歴
    new.tsx                # 新規タブ（CustomTabBar が /session/new にリダイレクト）
    report.tsx             # 最新セッションのレポートタブ
    settings.tsx           # 設定
  session/
    new.tsx                # セッション作成フォーム
    [id]/
      _layout.tsx          # セッション内 3 タブ（Log / Court / Report）
      log.tsx              # ポイントログ + PointLogSheet
      court.tsx            # コート図（勝敗フィルター）
      report.tsx           # 分析レポート
```

`app/(tabs)/new.tsx` はプレースホルダーで実際には `CustomTabBar` が `/session/new` へ押し込む。

### 状態管理（Zustand + AsyncStorage）

- `useSessionStore` — セッションと全ポイントを管理。persist key: `courtlens-sessions`
- `usePlayerStore` — プレイヤープロフィール。persist key: `courtlens-player-profile`
- ストアは `StorageAdapter` 経由で永続化。直接 AsyncStorage を import しない。
- コンポーネントはストアを直接購読してよい（ただし UI コンポーネント単体はストアに依存させない）。

### テーマシステム

全コンポーネントは **`useTheme()`** からカラーを取得する。静的 `colors` の直接 import は画面以外でも避けること（`constants/` や `components/court/CourtChart.tsx` など一部に残存している旧パターンは触らない）。

```typescript
const { colors, mode, withAlpha } = useTheme();
// mode: 'light' | 'dark' — useColorScheme() で自動切替
```

`src/theme/colors.ts` に Refined Court パレット（ライト + ダーク）を定義。`ColorTokens` 型は widened string なのでどちらのパレットも代入できる。compat alias（`overlay`, `navyLight`, `courtBlue` 等）は既存コードのために残している。

### 分析サービス

```typescript
getAnalyzer().analyze(session)  // → TennisAnalysisResult
```

`ManualAnalyzer` がルールベース分析の唯一の実装。`TennisAnalyzer` インターフェース経由で使い、`ManualAnalyzer` は直接 import しない。`src/data/coachingRules.ts` に 7 パターンの弱点ルールがある。

### ドメイン型の要点

- `TennisSession` は discriminated union: `HardTennisSession | SoftTennisSession`。`session.sport` で分岐。
- `PointRecord` の必須フィールド: `shotType`, `resultReason`, `outcome`, `rallyCount`。`serveResult` と `shotLocation` は optional。
- コート座標は 0〜1 の正規化座標（`ShotLocation`）。`src/utils/court-geometry.ts` の `toCanvas / toNormalized` で変換。

### ポイント入力フロー

`PointLogSheet`（5 ステップの底面シート）が `log.tsx` で使われる。ステップ順: サーブ → ショット → 理由 → ラリー数 → コース（タップで自動コミット）。コースはスキップ可能。

### コンポーネント設計

- `src/components/common/` — テーマ対応の汎用プリミティブ。`StatCard` の API は `stat: StatCardData`（`label`, `value`, `unit?`, `delta?`, `trend?`）でバリアントは `numeric | spark | ring`。
- `src/components/court/` — `CourtCanvas`（SVG 描画）→ `CourtChart`（タップ + ドット）→ `CourtHeatmap`（ヒートマップ）の3層。
- `src/components/point/` — `PointLogSheet`（入力シート）、`PointScoreboard`（スコア表示）は新設。`PointLoggerForm` は旧式で残存中。
- `router.push()` は expo-router の型が厳格なため `router.push(path as any)` が必要。画面内で `const push = (path: string) => router.push(path as any)` のヘルパーを作り `// eslint-disable-next-line` と組み合わせること。

## ドキュメント

開発ログは `docs/development-logs/yyyymmdd_内容.md` 形式で管理。アーキテクチャ・データモデル等の参照ドキュメントも同フォルダに収録。
