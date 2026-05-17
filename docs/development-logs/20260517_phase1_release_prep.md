# Phase 1 — リリース準備（開発ログ）

**実施日**: 2026-05-17  
**対象ブランチ**: master

---

## 目的

CourtLens v1.0.0 の TestFlight 配信に向けたリリース準備。アイコン統一・UX 改善・オンボーディング強化・撮影ガイドの 4 本柱。

---

## 実施内容

### 1-A. アプリアイコン統一（`scripts/generate-icons.mjs`）

- `sharp` + 手書き SVG ジオメトリ（テニスコートのサービスライン形状）で 1024×1024 PNG を生成するスクリプトを作成。
- コートマーク計算: `S = 1024 * 0.60 / 14 ≈ 43.89`、`O = (1024 - 14 * S) / 2 ≈ 204.8`（縦線14本でコート区画を描画）。
- **重要な修正**: 初回生成で `icon.png` が RGBA（4ch）になる問題を発見。App Store が 3ch RGB を要求するため、`sharp().flatten({ background: '#1F6F4A' })` でアルファを合成してから保存するよう修正。
- 生成物:
  - `assets/icon.png`: RGB (opaque), 1024×1024, 緑背景 `#1F6F4A`
  - `assets/adaptive-icon.png`: RGBA（Android が背景色を追加）
  - `assets/splash-icon.png`, `assets/splash.png`: opaque

### 1-B. 新規セッション画面の戻るボタン（`app/session/new.tsx`）

- `Stack.Screen` の `headerLeft` に `<Ionicons name="chevron-back">` を用いたカスタムボタンを追加。
- `router.back()` で遷移。
- タップ領域: `minHeight: 44, minWidth: 44`（iOS HIG 準拠）。

### 1-C. 注釈付きオンボーディングモック（`src/components/onboarding/`）

追加コンポーネント:
- `MockNewSessionCard.tsx` — セッション作成フォームのモック画像（ウィジェット＋ラベル）。
- `MockPointLogCard.tsx` — ポイント記録シートのモック画像。
- `MockReportCard.tsx` — 分析レポートカードのモック画像。
- `AnnotationCallout.tsx` — モック画像上に重ねる吹き出し注釈コンポーネント（矢印 + テキスト、`useTheme()` 対応）。

`app/onboarding.tsx` にモック画像を組み込み、各ステップで実際の UI の見た目と操作方法を可視化。

### 1-D. 撮影ガイド画面（`app/recording-guide.tsx`）

- 推奨撮影条件（三脚設置・コート全体を収める・2 m 以上の距離）をカード形式で提示。
- `app/session/new.tsx` のヘッダエリアにリンクボタン（Ionicons `information-circle-outline`）を設置。
- SafeAreaView + ScrollView で長い説明文に対応。

---

## 変更ファイル一覧

| ファイル | 種別 | 内容 |
|---|---|---|
| `scripts/generate-icons.mjs` | 新規 | アイコン生成スクリプト |
| `assets/icon.png` | 更新 | CourtLens アイコン（RGB opaque） |
| `assets/adaptive-icon.png` | 更新 | Android 用アダプティブアイコン |
| `assets/splash-icon.png` | 更新 | スプラッシュアイコン |
| `assets/splash.png` | 更新 | スプラッシュ画像 |
| `app/session/new.tsx` | 更新 | ヘッダ戻るボタン + ガイドリンク |
| `app/recording-guide.tsx` | 新規 | 撮影ガイド画面 |
| `src/components/onboarding/AnnotationCallout.tsx` | 新規 | 注釈吹き出しコンポーネント |
| `src/components/onboarding/MockNewSessionCard.tsx` | 新規 | セッション作成モック |
| `src/components/onboarding/MockPointLogCard.tsx` | 新規 | ポイント記録モック |
| `src/components/onboarding/MockReportCard.tsx` | 新規 | レポートモック |
| `app/onboarding.tsx` | 更新 | モック画像・注釈を各ステップに組込み |

---

## 既知の制約・注意事項

- `scripts/generate-icons.mjs` は `sharp` を devDependency として使用。アイコン変更時は `node scripts/generate-icons.mjs` を再実行し `app.json` のバージョンを上げる。
- splash.png の背景色は `app.json` の `backgroundColor` と揃えること。

---

## 次フェーズ

Phase 2: オンデバイス姿勢推定によるフォーム分析（`20260517_phase2_pose_form_analysis.md` 参照）。
