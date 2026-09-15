# 20260915 UI リデザイン(Claude Design 取り込み)+ Settings 無限ループ修正

CourtLens の UI を Claude Design のデザインキャンバスから取り込んで実装。あわせて起動時に露見した Settings のクラッシュ(無限再レンダ)を修正し、デザイン方向を主要画面へ横展開した。

## 経緯
- `claude_design` MCP(DesignSync)で `/design-login` 認証 → プロジェクト `CourtLens Redesign.dc.html` を読み込み。
- 内容: ① ホーム(1a 手堅い / 1b 大胆)、⑩ ラリー履歴(1c 手堅い / 1d ラダー)。各 light/dark。基盤に **Saira Condensed(数値専用)** + **ダークパレット刷新**。
- ユーザー選択: **ホーム=1b(大胆)/ ラリー履歴=1d(ラダー)/ Saira Condensed 追加=承認**。

## 実装
### 基盤(コミット `35a684a`)
- `@expo-google-fonts/saira-condensed` 追加、`_layout` で 600/700 ロード。`theme/typography` に `fontFamily.numeric`。
- `theme/colors` のダークを刷新トークンへ。`hero`/`heroAccent`/`onHero`/`tileNavy`(濃紺タイル)を追加(light/dark 両方)。

### ホーム 1b
- フルブリード濃緑ヒーロー:**コンディション 0-100**(勝率+ファースト率+直近成績から決定的に算出、誇張なし)+ 増減チップ + 勝敗チップ + コート装飾。
- 2×2 ヘアライン・スタッツグリッド、ラリー履歴カード(実験的)、最新レポートカード(ポイント差 + WIN/ERR。セットスコアは捏造しない)、濃紺フォーム分析タイル + 小タイル2。
- ハマり: `gap:1 + width:49.9%` で 2×2 が1列に潰れた → 2行×flex:1 + ヘアラインborder に修正。

### ラリー履歴 1d(ラダー)
- `_layout` に `rally-history` を `headerShown:false` で明示追加 → カスタム濃緑ヘッダー。
- ラリー長ヒストグラム、未確定の「まとめて確認」バー。
- **ラダー**:自陣/相手レール + ストローク色ノード(サーブ=琥珀/フォア=緑/バック=紺/相手=グレー)+ コース・速度、横向きバウンドコート(番号ドット + 破線軌跡 = react-native-svg)、勝ち/負け/未定トグル。他ラリーは折り畳み行。

### Settings 無限ループ修正(コミット `cdb6690`)
- **起動後 Settings タブで「Maximum update depth exceeded」赤画面**。原因は `useBetaStore((s) => ({...}))` が毎レンダで新オブジェクトを返し、zustand v5 の `useSyncExternalStore` が無限ループ。
- **既存の潜在バグ**(package.json は zustand ^5.0.13 のまま=今回の作業で入った依存ではない。Settings が今まで開かれていなかっただけ)。
- 修正: `settings.tsx` と `SubmissionSheet.tsx` の両方を **`useShallow`** でラップし snapshot 安定化。

### 全画面へ方向を横展開(コミット `6da3eae`)
- 共有コンポーネント経由で一括適用(効率的):
  - `SessionCard`(履歴/ホーム)、`StatCard`(レポート)、`MatchScoreboard`/`PointScoreboard`(ログ)の数値を **Saira Condensed** に。
  - レポートのヒーローを **`hero` トークン(濃緑)+ コート装飾 + Saira 数値**へ。**ヒーロー文字は `onHero`** に変更(ダークで `surface` のままだと不可視になる不具合を回避)。

## 検証(シミュレーター:light + dark)
- 描画・遷移・エラー無しを確認:**ホーム / ラリー履歴 / 履歴 / レポート / 設定**、およびセッション内 **Log / Video / Court / Report**。
- Appium(XCUITest, testID/accessibility)で赤画面チェック + スクショ取得。全画面 redbox=なし。
- type-check / lint / **テスト147件** すべてグリーン。検証用の一時 Redirect は revert 済み。

## カバレッジと残り
- **フル方向適用**: ホーム(1b)、ラリー履歴(1d)、レポート(ヒーロー+数値)、履歴/ログ(共有コンポーネント経由の数値・トークン)。
- **トークン継承のみ(個別ヒーロー未実装)**: 新規セッション、コート較正、ボール軌跡、自動採点、Video/Court、フォーム分析各ステップ、オンボーディング、ベータ同意、ヘルプ。これらは `useTheme` 経由で刷新ダークパレット+共有数値は反映済みだが、専用ヒーロー/レイアウト刷新は次段の課題。

## 注記(正直な適応)
- 「コンディション 0-100」はアプリに無かった概念のため既存指標からの**合成スコア**として実装。
- レポート/履歴のスコアはテニスのセットスコアを捏造せず、**ポイント差 / WIN・ERR** の実データで表現。

## 追記(同日): 2次画面を全て同方向へ(codex 実装 / Opus レビュー)

役割分担=**実装 codex(gpt-5.2)/ レビュー Opus**。残りの2次画面すべてに方向を適用(コミット `0db991e`)。

- 対象: session の auto-score / video / court / calibration / ball-trace、form-analysis(new/select/capture/[id])、session/new、onboarding、beta-consent、help、recording-guide、settings のプロフィール。共有 `Button`/`Chip`/`SegmentedControl`/`SecondSlider`/`FormScoreRing`/`SwingMetricCard`/`AutoPointCard` もトークン化コントラスト+数値化。
- 各画面: 濃緑ヒーロー(**onHero テキスト**+コート装飾)、Saira Condensed 数値、ヘアラインカード化。挙動/testID は不変(視覚のみ)。
- `Button` の primary/danger 文字色を `surface`→`onHero` に変更(ダークで緑ボタン上の文字が沈む不具合の解消)。

**Opus レビュー結果(承認)**:
- 静的スキャン: **hero上の surface 文字=0、accent の塗り使用=0**(= 私が踏んだコントラスト地雷を回避できている)。全画面で onHero + fontFamily.numeric 適用を確認。
- シミュレーター(Appium, light+dark): **設定 / コート較正 / 自動採点**を目視確認(ヒーロー+数値+コントラスト良好)。遷移で **赤画面ゼロ**。
- type-check / lint / **テスト147件** グリーン。
- 未目視(静的+代表画面で担保): video/ball-trace/form 各ステップ/new/onboarding 等。リスクは視覚的な作り込みの粗さのみで、正当性・コントラストは担保。
