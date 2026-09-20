# 2026-09-19: TestFlight 製品化 Phase 3（ビルド配信）/ Phase 4（実機検証）

`feat/video-analysis-productize` の Phase 1（Sentry 配線）・Phase 2（権限デッドエンド／タイムアウト耐性）に続く、
**TestFlight 実ビルドと実機検証**のフェーズ。Phase 1/2 の定義はコミットメッセージ本文にしか存在せず
repo から辿れなかったため、本ログで Phase 3/4 の定義ごと残す。

## フェーズ定義

| Phase | 内容 | 状態 |
|---|---|---|
| Phase 1 | Sentry 配線 + ErrorBoundary（`59d9f3c`） | 完了 |
| Phase 2 | 権限デッドエンド / アップロードタイムアウト / クラウドエラー文言（`fdb0032`） | 完了 |
| **Phase 3** | **設定の環境変数化・EAS ビルド・TestFlight 提出** | 進行中 |
| **Phase 4** | **実機検証（Phase 1/2 の live validation を含む）** | 未着手 |

## 今回の方針決定

1. クラウドショット解析（TrackNetV4）を**このビルドに含める** — Supabase を用意して有効化
2. Sentry を**有効化する**（DSN + sourcemap アップロード）
3. 設定値は **`app.config.ts` + 環境変数**へ移行 — **リポジトリが GitHub で PUBLIC** のため鍵を直書きできない
4. 配布は **Internal Testing のみ**（Beta App Review 不要）

## Phase 3 で実施した変更

### `app.json` → `app.config.ts`（`511afb3`）

鍵を環境変数経由にした。読み取り側（`app/_layout.tsx`、`cloudAnalyze.ts`、`videoUpload.ts`、
`uploader.ts`）はすべて `Constants.expoConfig.extra` 経由なので **`src/` / `app/` は無変更**。

| 環境変数 | 流れ込み先 | 空のときの挙動 |
|---|---|---|
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` | `extra.submission` | `auto-score.tsx:36` の `CLOUD_ANALYSIS_AVAILABLE` が false → **クラウド解析ボタンが非表示** |
| `SENTRY_DSN` | `extra.sentryDsn` | `Sentry.init({ enabled: ... && Boolean(dsn) })` で無効 |
| `SENTRY_ORG` / `SENTRY_PROJECT` | Sentry Expo プラグイン | **プラグインごと未登録**（後述） |
| `SENTRY_AUTH_TOKEN` | sentry-cli（ビルド時のみ） | sourcemap アップロード不可 |

**Sentry プラグインを条件付き登録にした理由**: このプラグインはビルド時に `sentry-cli` を呼ぶため、
`REPLACE_ME` のまま残すと sourcemap アップロード段でビルドが落ちうる。org/project が揃わなければ
プラグインごと外すことで、鍵なし環境でも必ずビルドが通る退避経路を確保した。

移行の等価性は `expo config --type public --json` の前後 diff で確認済み（差分は上記の条件付きプラグインのみ）。

### `eas.json`（`5b095ce`）

- `cli.appVersionSource: "local"` を明示。**`autoIncrement` は削除** — dynamic config では EAS が
  buildNumber を書き戻せないため、`app.config.ts` で手動管理する。
- production プロファイルに `"environment": "production"` を指定。EAS の `production` 環境変数が
  ビルド時に `app.config.ts` へ流れ込む。
  **注意**: `eas.json` の `env` ブロックはリテラル文字列のみで `$VAR` 展開はしない。最初これを誤り、修正した。
- `submit.production.ios.appleTeamId: "7H57MX827T"` を追加（非対話提出でチーム選択に止まらないように）。
- `npm run build:ios` / `npm run submit:ios` を追加。

### 依存の整合（`4810a15`）

`npx expo install --fix` でパッチレベルのずれ 6 件を解消。expo-doctor **17/17 pass**。

`react-native-fast-tflite` の「Untested on New Architecture」警告は **stale metadata と判断して exclude**。
v3.0.1 は Nitro Modules 製（`s.module_name = 'NitroTflite'`、`nitrogen/` 生成物あり）で
New Architecture 専用であり、peer の `react-native-nitro-modules@0.35.6` も package-lock に解決済み。

### バージョン（`6cad1c1`）

`1.1.0 (3)` → **`1.2.0 (4)`**。クラウドショット解析が入る最初の版なのでマイナーを上げた。

### ドキュメント修正（`0388c0a`）

`docs/cloud-analysis-api.md` が `cloudResultToCandidates`（`src/services/scoring/cloudCandidates.ts`）を
「実装済」と書いていたが、`23e58c6` で dead code として削除済み。実際は
`cloudResultToRallyAnalysis` → `rally-history.tsx` の経路。

## Phase 3 完了（2026-09-20）

| # | 内容 | 結果 |
|---|---|---|
| U1 | Supabase — バケット `beta-submissions`(private, 50MB, video/mp4) + anon の INSERT/UPDATE/SELECT | 完了。**実測検証済**（下記） |
| U2 | Sentry — org `yosuke-muroi` / project `courtlens`(US リージョン) | 完了。token scope `org:ci` |
| U3 | App Store Connect API Key `476ZM6PG45`(ADMIN) | 既存のものが使えた |
| U4 | Distribution Certificate + Provisioning Profile `NQT953UG9P` | 完了（2027-09-20 まで有効） |
| U5 | プライバシーポリシーの公開 URL | **未確認**（Internal Testing では不要なので保留） |

### 途中で詰まった点

- **Apple Developer Program のメンバーシップが失効**していた（2025-06 登録、2026-06 頃に期限切れ）。
  `eas credentials` が `You have no team associated with your Apple account` で失敗。
  更新時に決済も一度拒否されたが、最終的に解決。EAS 側に残っていた team `7H57MX827T` は古いキャッシュだった。
- **Supabase の API キーが新方式に変わっていた**。`anon`(JWT) ではなく `sb_publishable_...` が発行される。
  JWT ではないため `Authorization: Bearer` に載せる現行コードで動くか不明だったが、
  **実測で PUT/sign/GET すべて 200** だったので `videoUpload.ts` は無変更で済んだ。
- `.env.local` にキーが重複記載されていた（テンプレートの空行 + 追記）。整理済み。

### Supabase 疎通の実測（ビルド前に検証）

`videoUpload.ts` と同じヘッダ・同じパスで実際に叩いた結果:

| ステップ | 結果 |
|---|---|
| PUT `/object/beta-submissions/analysis/<id>/video.mp4`（insert+update ポリシー） | **200** |
| POST `/object/sign/...`（select ポリシー） | **200**、signedURL 取得 |
| 署名URLを**無認証で GET**（Modal と同じ動き） | **200**、バイト数一致 |

### ビルド結果

| | |
|---|---|
| Build ID | `33eb4105-5fd9-480e-a700-a8966f708924` |
| Version | **1.2.0 (4)**、commit `59c5153` |
| 所要 | 5 分 21 秒（16:07:15 → 16:12:36） |
| Fingerprint | `a902130655779def98a4742a83bdd0839e055c09` |

**Sentry の sourcemap アップロードは成功**。ただし確認方法に注意:
現在の Sentry SDK は **Debug ID 方式**で、リリースを作らずに artifact bundle を上げる。
`sentry-cli releases list` は 0 件のままなので、これを失敗と誤認しないこと。正しい確認先:

- `/api/0/projects/<org>/<project>/files/artifact-bundles/` → 1 件（JS sourcemap）
- `/api/0/projects/<org>/<project>/files/dsyms/` → 4 件（ネイティブ）

### Phase 4 の Sentry 検証について

E-16（未ハンドルのクラッシュ）は意図的なクラッシュ導線が必要だが、
**E-17（ハンドル済みエラー）は追加ビルドなしで検証できる**。
機内モードでクラウド解析を実行すると `useAutoScore` の `captureException` が発火するため、
**C-10 と E-17 を同時に確認できる**。

手順の詳細（Supabase のバケット/RLS、Sentry の slug と token、`eas credentials` のプロンプト、
`eas env:create` の visibility の使い分け）は **`docs/testflight-release-runbook.md`** に分離した。

## Phase 4: 実機検証チェックリスト

実機必須（シミュレーターでは TFLite/CoreML とカメラが検証できない）。

### A. 起動と基本導線
- [ ] 初回起動 → オンボーディング 7 ステップ → ホーム
- [ ] セッション作成（硬式/ソフト × 試合/練習）→ ポイント手動記録 → レポート
- [ ] ダークモードで崩れないか（トークン継承のみの画面: 新規セッション・較正・ball-trace・auto-score・form-analysis・オンボーディング・ベータ同意・ヘルプ）

### B. 権限（Phase 2 の live validation）
- [ ] カメラ/マイク拒否状態で `VideoRecorder` → 設定アプリへの導線が出るか（`VideoRecorder.tsx:56,92-93`）
- [ ] `canAskAgain === false` でも詰まらないか
- [ ] フォトライブラリ拒否 → 動画選択が安全に失敗するか

### C. クラウド解析（今回の目玉）
- [ ] `auto-score` でクラウド解析ボタンが**表示される**（= Supabase 設定が効いている）
- [ ] 短尺 30〜60 秒: アップロード → Modal 解析 → `rally-history` に速度/コース/FH-BH
- [ ] 長尺 5〜10 分: 20 分ポーリング内に完了（実測目安: 600 秒クリップで T4 stride1 ≒ 471 秒）
- [ ] 機内モードでアップロード → 120 秒タイムアウトの日本語エラー（Phase 2 の live validation）
- [ ] 解析中にバックグラウンド → 復帰後にポーリング継続するか（**未検証の挙動**）

### D. オンデバイス経路（サーバー不要）
- [ ] `ball-trace` でボール軌跡が描画される
- [ ] 較正なしの「自動ラリー検出」→ draft ポイント追加 → 得点/失点トグル
- [ ] フォーム分析（TFLite + CoreML、実機のみ）— 処理時間とメモリも記録
- [ ] エクスポート（CSV / Markdown / ラリーラベル JSON / 動画共有）

### E. Sentry
- [ ] 意図的クラッシュ → Sentry に届く。**sourcemap が効いた読めるスタックトレース**か
      （一時的なデバッグ導線を使う場合は**検証後に必ず削除**）
- [ ] ハンドル済みエラー（`useAutoScore` の `captureException`）が出るか

### F. 安定性
- [ ] 長尺動画のフレーム抽出時のメモリ
- [ ] 30 分程度の連続使用でクラッシュしないか

## 既知のリスク

1. **Modal エンドポイントが無認証**。ipa から URL は抜ける。Internal Testing のみ・短期なので許容するが、
   外部テスター/公開の前に必ずガードが必要。
2. **Supabase anon key がアプリバイナリに載る**（設計上不可避）。バケットをプライベートにし、
   ポリシーを `analysis/%` に限定し、ファイルサイズ上限を設定してリスクを絞る。
3. **OTA 更新なし**（`expo-updates` 未導入）。修正のたびにフルビルド + 提出。
4. **CI なし**（`.github/` 不在）。type-check/lint/test はローカル手動実行のみ。
5. ローカル node が v20.19.2 で react-native 0.81.5 の要求 `>= 20.19.4` を下回る（EAS のビルド環境には無関係）。

## 検証結果

（Phase 4 実施後に追記）
