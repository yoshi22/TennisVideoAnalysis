# 20260515 デザインリフレッシュ — Refined Court (ライト + ダーク)

## 概要

CourtLens の全画面を「Refined Court」デザインパレット（ライト + ダーク）に刷新した。SwingVision / Strava / Nike Run Club に近い、スポーツアプリらしいビジュアルアイデンティティを確立することが目的。機能的な変更は行わず、アナライザ・ストア・ビデオパイプラインはそのまま維持した。

---

## 確定事項（事前合意）

- タブバー: 5タブ + 中央 FAB（新規）。カスタムの `CustomTabBar` で実装し、新規タップは `/session/new` にリダイレクト。
- ライト + ダーク両対応。`useColorScheme()` でシステム設定に追従。手動切替は将来実装。
- フォント: `@expo-google-fonts/inter` + `@expo-google-fonts/noto-sans-jp`。Inter_400〜700 / NotoSansJP_400〜700 を `app/_layout.tsx` でロードし、`useFonts` 完了まで SplashScreen でゲート。
- Phase B（履歴・設定）のみ Codex で並列実装。Home / Session系 / Report は Claude が担当。

---

## 追加ファイル

**テーマ**
- `src/theme/radius.ts` — `s/m/l/xl/pill` の角丸定数
- `src/theme/ThemeProvider.tsx` — `useColorScheme()` ベースのコンテキスト + `withAlpha` ヘルパー

**共通コンポーネント**
- `src/components/common/BrandMark.tsx` — ロゴマーク
- `src/components/common/CourtLines.tsx` — 装飾用コートSVG
- `src/components/common/Tag.tsx` — ピル型タグ
- `src/components/common/Sparkline.tsx` — 折れ線スパークライン
- `src/components/common/Donut.tsx` — SVGドーナツチャート
- `src/components/common/ProgressRing.tsx` — SVGプログレスリング
- `src/components/common/SessionCard.tsx` — セッション一覧カード
- `src/components/common/CustomTabBar.tsx` — 5タブ + 中央FABカスタムタブバー

**ポイントコンポーネント**
- `src/components/point/PointScoreboard.tsx` — ライブスコアボード
- `src/components/point/PointLogSheet.tsx` — 5ステップ入力ボトムシート（サーブ→ショット→理由→ラリー→コース）

**ルート**
- `app/(tabs)/new.tsx` — 新規タブのリダイレクトプレースホルダー
- `app/(tabs)/report.tsx` — 最新セッションレポートタブ（セッションなし時は EmptyState）

---

## 変更ファイル

**テーマ**
- `src/theme/colors.ts` — Refined Court ライト / ダーク両パレット。`ColorTokens` 型を widened string に統一し、compat alias (overlay, navyLight, courtBlue など) を追加。
- `src/theme/typography.ts` — Inter / NotoSansJP ファミリスタック。display/h1〜h3 を追加。tabular-nums スタイル。
- `src/theme/index.ts` — 全エクスポートを更新

**レイアウト**
- `app/_layout.tsx` — フォントロード + SplashScreen ゲート + ThemeProvider ラップ
- `app/(tabs)/_layout.tsx` — `CustomTabBar` に切替。5タブ定義。
- `app/session/[id]/_layout.tsx` — `useTheme()` に切替

**共通コンポーネント更新**
- `StatCard.tsx` — `stat: StatCardData` API に統一。`numeric / spark / ring` バリアント対応。
- `Card.tsx`, `Chip.tsx`, `Button.tsx`, `EmptyState.tsx`, `SectionHeader.tsx` — 全て `useTheme()` に切替

**画面**
- `app/(tabs)/index.tsx` — ヒーローヘッダー + コートモチーフ + スパーク統計4枚 + レポートバナー + 直近3セッション
- `app/(tabs)/history.tsx` — (Codex) フィルターチップ + 月別グループ
- `app/(tabs)/settings.tsx` — (Codex) イニシャルアバター + セクション付き設定リスト
- `app/session/new.tsx` — `useTheme()` + 動画ドロップゾーン更新
- `app/session/[id]/log.tsx` — スコアボード + 得点/失点ビッグボタン + サイドバー付きポイントリスト + PointLogSheet
- `app/session/[id]/court.tsx` — 勝敗フィルターチップ (all/won/lost) + 凡例
- `app/session/[id]/report.tsx` — ヒーローカード + 4列キースタット + ドーナツ + ヒートマップ + 強み/改善ポイント/コーチコメント/練習メニュー

---

## Codex 連携

History と Settings の 2 ブリーフを並列で Codex に委託した。両画面ともに `src/theme/*`, `src/types/*`, `src/stores/*` の編集禁止を明示し、完了後に型チェック + リントで検証。両画面とも 0 エラーで着地した。

---

## 検証結果

- `npm run type-check` — エラー 0
- `npm run lint` — エラー 0（VideoRecorder.tsx の既存警告 1 件はリフレッシュ前から存在）
- `npm test` — 3/3 パス（ManualAnalyzer.test.ts）

---

## 既知の制限 / フォローアップ

- アナライザ由来の統計はセッションデータが存在しないと 0 / empty になる。ダミーデータを投入すれば動作確認可能。
- システムの外観を Dark にするとダークパレットに切り替わるが、実機 + iOS シミュレーターでの目視確認は未実施。
- 手動テーマ切替（将来的な設定スイッチ）は未実装。
- Inter / NotoSansJP のフォールバック確認は未実施（Expo Go 利用時にフォントが遅延する場合がある）。
