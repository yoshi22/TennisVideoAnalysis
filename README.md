# CourtLens

CourtLens は、硬式テニス・ソフトテニス向けの動画分析アプリ MVP です。試合や練習セッションに動画を紐づけ、ポイントごとの結果、ショット種別、ラリー数、打球位置を手動で記録し、スタッツとコーチングコメントとして振り返れます。

## スクリーンショット

（準備中）

## 開発環境セットアップ

```bash
npm install
npx expo start
```

Expo 開発サーバー起動後、iOS Simulator、Android Emulator、または Expo Go で動作確認します。

## コマンド一覧

| コマンド | 説明 |
| --- | --- |
| `npm run start` | Expo 開発サーバーを起動 |
| `npm run ios` | iOS Simulator で起動 |
| `npm run android` | Android Emulator で起動 |
| `npm run type-check` | TypeScript 型チェック |
| `npm run lint` | ESLint 実行 |
| `npm test` | Jest テスト実行 |

## ディレクトリ構成

```text
.
├── app/                         # Expo Router screens
│   ├── (tabs)/                  # ホーム、履歴、設定
│   └── session/                 # セッション作成、ログ、コート、レポート
├── src/
│   ├── components/              # common / point / court / video UI
│   ├── constants/               # ショット種別、サーブ結果、コート寸法
│   ├── data/                    # サンプルデータ、コーチングルール
│   ├── services/                # analysis / storage / video services
│   ├── stores/                  # Zustand stores
│   ├── theme/                   # colors / spacing / typography
│   ├── types/                   # ドメイン型定義
│   └── utils/                   # ID、日付、表示形式、座標変換
├── __tests__/                   # Jest tests
├── docs/                        # Phase 6 documents
│   ├── 00_product_direction.md
│   ├── 01_architecture.md
│   ├── 02_data_model.md
│   ├── 03_ai_analysis_roadmap.md
│   ├── 04_development_log.md
│   └── 05_soft_tennis_strategy.md
├── app.json
├── package.json
├── tsconfig.json
└── jest.config.js
```

## 実装済み機能

### Phase 1: プロジェクト基盤

- Expo / React Native / TypeScript プロジェクト構成。
- Expo Router による画面ルーティング。
- TypeScript strict、path alias、ESLint、Prettier、Jest 設定。
- テーマと共通 UI コンポーネント。

### Phase 2: ドメインモデルと永続化

- `TennisSession`、`PointRecord`、`PlayerProfile`、分析型の定義。
- 硬式テニス/ソフトテニスを扱う discriminated union。
- Zustand persist + AsyncStorage によるローカル保存。
- `StorageAdapter` 抽象化。
- サンプルセッションデータ。

### Phase 3: セッション管理と動画

- ホーム、履歴、設定、セッション作成画面。
- 試合/練習、硬式/ソフトテニス、シングルス/ダブルスのセッション作成。
- 動画撮影、ライブラリ選択、動画サムネイル表示。
- プロフィール保存、サンプルデータ投入、データ初期化。

### Phase 4: ポイント入力とコート可視化

- セッション内の Log / Court / Report タブ。
- 得点/失点、サーブ結果、ショット種別、結果理由、ラリー数、ショット位置の記録。
- SVG ベースのコート表示。
- ショット位置フィルタとヒートマップ。

### Phase 5: 分析とコーチング

- `ManualAnalyzer` によるルールベース分析。
- 1st サーブ成功率、2nd サーブ成功率、ダブルフォルト数、エース数、得点率、平均ラリー数。
- 弱点検出、強み抽出、改善コメント、練習メニュー生成。
- ManualAnalyzer の Jest テスト。

### Phase 6: ドキュメントと最終検証

- `docs/` 配下のプロダクト、設計、データモデル、AI ロードマップ、開発ログ、ソフトテニス戦略ドキュメント。
- README の本番品質化。
- TypeScript、ESLint、Jest による最終検証。

## v1 ロードマップ

- Computer Vision によるボールトラッキング。
- ショット自動分類。
- サーブ速度推定。
- 姿勢推定によるフォーム解析。
- 自動ハイライト生成。
- LLM によるパーソナライズドコーチングコメント。
- ソフトテニスの前衛/後衛、雁行陣、並行陣、ポーチ分析。
- ダブルス向けの前衛決定率、ポーチ成功率、ペア連携分析。
- コーチ向けの生徒管理機能。
- Supabase / Firebase などへのクラウド同期。

## 詳細ドキュメント

- [Product Direction](docs/00_product_direction.md)
- [Architecture](docs/01_architecture.md)
- [Data Model](docs/02_data_model.md)
- [AI Analysis Roadmap](docs/03_ai_analysis_roadmap.md)
- [Development Log](docs/04_development_log.md)
- [Soft Tennis Strategy](docs/05_soft_tennis_strategy.md)
