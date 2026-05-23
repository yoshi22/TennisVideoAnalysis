# CLAUDE.md

## プロジェクト

**CourtLens** — 硬式テニス・ソフトテニス向け動画分析 MVP。試合・練習セッションにポイント記録を紐づけ、スタッツとコーチングコメントを生成する React Native (Expo) アプリ。

## コマンド

```bash
npm run type-check        # TypeScript 型チェック（エラー 0 が必須）
npm run lint              # ESLint（エラー 0 が必須）
npm test                  # Jest（watchman 無効化済み）
npx prettier --write "path/to/file.tsx"  # 単体フォーマット
```

変更後は必ず `npm run type-check && npm run lint` を通す。Prettier エラーは lint で出るため、書いたファイルは都度 `npx prettier --write`。

## 規約・gotcha（コードから読み取れない点のみ）

- **状態管理**: 永続化は必ず `StorageAdapter` 経由。`AsyncStorage` を直接 import しない。persist key は `useSessionStore`→`courtlens-sessions`、`usePlayerStore`→`courtlens-player-profile`。UI コンポーネント単体はストアに依存させない。
- **テーマ**: カラーは必ず `useTheme()` から取得（`const { colors, mode, withAlpha } = useTheme()`）。静的 `colors` の直接 import は避ける。`constants/` や `components/court/CourtChart.tsx` に残る旧パターンは触らない。
- **分析**: `getAnalyzer().analyze(session)` を使う。唯一の実装 `ManualAnalyzer` を直接 import せず `TennisAnalyzer` インターフェース経由で。弱点ルールは `src/data/coachingRules.ts`。
- **ルーティング**: `app/(tabs)/new.tsx` はプレースホルダー。実際は `CustomTabBar` が `/session/new` へリダイレクトする。
- **router.push**: expo-router の型が厳格なため `router.push(path as any)` が必要。画面内で `const push = (path: string) => router.push(path as any)` ヘルパー + `// eslint-disable-next-line` を使う。

## ドメイン型

- `TennisSession` は discriminated union（`HardTennisSession | SoftTennisSession`）。`session.sport` で分岐。
- `PointRecord` 必須: `shotType`, `resultReason`, `outcome`, `rallyCount`。`serveResult`/`shotLocation` は optional。
- コート座標は 0〜1 正規化（`ShotLocation`）。変換は `src/utils/court-geometry.ts` の `toCanvas / toNormalized`。

## ドキュメント

開発ログ・参照ドキュメントは `docs/development-logs/`（`yyyymmdd_内容.md` 形式）。

---

## Behavioral Guidelines (Karpathy)

Four principles to reduce common LLM coding mistakes. Full detail: `/karpathy-guidelines` skill.

1. **Think Before Coding** — surface assumptions; ask when unclear.
2. **Simplicity First** — minimum code; nothing speculative.
3. **Surgical Changes** — touch only what the request requires.
4. **Goal-Driven Execution** — define verifiable success criteria, then loop.

Source: [Karpathy](https://x.com/karpathy/status/2015883857489522876) / [multica-ai/andrej-karpathy-skills](https://github.com/multica-ai/andrej-karpathy-skills) (MIT).
