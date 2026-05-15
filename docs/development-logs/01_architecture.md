# Architecture

## 技術スタック

- React Native: iOS / Android のネイティブ UI を単一コードベースで構築するため。
- Expo: カメラ、動画選択、ルーティング、開発サーバーなど MVP に必要な機能を短期間で統合するため。
- Expo Router: `app/` ディレクトリベースでタブ、ネストしたセッション画面、詳細画面を管理するため。
- TypeScript: テニス種別、ポイント、分析結果などのドメインモデルを型で保護するため。
- Zustand: セッションとプレイヤープロフィールの状態管理を軽量に実装するため。
- Zustand persist + AsyncStorage: ローカルファーストの MVP として、アプリ再起動後もデータを保持するため。
- react-native-svg: コート図、ショット位置、ヒートマップをネイティブに描画するため。
- expo-camera / expo-image-picker / expo-video: 動画撮影、ライブラリ選択、サムネイル表示を実装するため。
- Jest + jest-expo: 分析ロジックを UI から切り離して検証するため。
- ESLint + Prettier: TypeScript / React Native のコード品質と整形を揃えるため。

## ディレクトリ構成

- `app/`: Expo Router の画面定義。ホーム、履歴、設定、セッション作成、セッション内タブを持つ。
- `src/types/`: `TennisSession`、`PointRecord`、`PlayerProfile`、分析結果、コート関連の型。
- `src/stores/`: Zustand store。セッションとプロフィールを永続化する。
- `src/services/`: 分析、動画、ストレージなど、画面から独立した処理。
- `src/components/`: 再利用 UI。共通部品、ポイント入力、コート表示、動画部品に分割。
- `src/constants/`: ショット種別、サーブ結果、コート寸法などの定数。
- `src/data/`: 開発用サンプルセッションとコーチングルール。
- `src/theme/`: 色、余白、タイポグラフィ。
- `src/utils/`: ID 生成、日付、表示フォーマット、コート座標変換。
- `__tests__/`: Jest テスト。
- `docs/`: プロダクト、設計、データモデル、AI ロードマップ、開発ログ、ソフトテニス戦略。

## データフロー

### Store から Component

1. 画面は `useSessionStore` または `usePlayerStore` から必要な状態と action を取得する。
2. UI コンポーネントは props と store の値から表示を組み立てる。
3. ユーザー操作で `addSession`、`addPoint`、`deletePoint`、`setProfile` などの action を呼ぶ。
4. Zustand の状態更新後、参照している画面が再レンダーされる。
5. persist middleware が状態を AsyncStorage に保存する。

主な例:

- ホーム画面: `sessions` を読み、直近セッションと分析サマリーを表示する。
- 履歴画面: `sessions` を日付順に並べ、長押しで `deleteSession` を呼ぶ。
- ポイントログ画面: `addPoint` / `deletePoint` でセッション内の `points` を更新する。
- 設定画面: `profile` の作成、更新、セッション初期化、サンプルデータ投入を行う。

### Service から Screen

1. 画面は `getAnalyzer()` で分析 service を取得する。
2. `ManualAnalyzer.analyze(session)` がポイント配列からスタッツと弱点を計算する。
3. `CoachingTipsGenerator` と `PracticeMenuGenerator` が `WeaknessPattern` を Tips / Drill に変換する。
4. レポート画面は分析結果を StatCard、ショット内訳、強み、弱点、改善コメント、練習メニューとして表示する。

動画まわりは `VideoPickerSheet` が `pickVideoFromLibrary`、`VideoRecorder` が `startRecording` / `stopRecording` を呼び、取得したローカル URI をセッションに保存する。

## 永続化の仕組み

永続化は Zustand persist と AsyncStorage を組み合わせている。

- `src/stores/sessionStore.ts`: `courtlens-sessions` に `sessions` を保存する。
- `src/stores/playerStore.ts`: `courtlens-player-profile` に `profile` を保存する。
- `src/services/storage/StorageAdapter.ts`: `getItem` / `setItem` / `removeItem` の抽象インターフェース。
- `src/services/storage/AsyncStorageAdapter.ts`: AsyncStorage を `StorageAdapter` として実装する。
- `src/services/storage/index.ts`: 現在の `defaultStorage` を公開する。

この構成により、store は AsyncStorage の詳細に依存せず、将来のストレージ差し替えを局所化できる。

## 将来の差し替えポイント

- Supabase: セッション、ポイント、プロフィールのクラウド同期、認証、コーチと選手の共有に差し替える候補。
- Firebase: モバイル向けの認証、Firestore、Storage、Analytics を利用する候補。
- CV API: 動画 URI を入力として、ボール軌道、ショット位置、プレイヤー位置、フォーム情報を返す外部 service として追加する。
- LLM API: ManualAnalyzer の弱点検出結果、プレイヤープロフィール、過去セッションを入力に、個別化されたコメントを生成する service として追加する。
- StorageAdapter: AsyncStorage から SecureStore、SQLite、クラウド同期付き repository に差し替える境界。
- TennisAnalyzer: `ManualAnalyzer` から `ComputerVisionAnalyzer`、`HybridAnalyzer` へ段階的に差し替える境界。
