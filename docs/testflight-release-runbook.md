# TestFlight リリース ランブック（CourtLens）

`npm run build:ios` を叩く前に一度だけ必要なアカウント設定と、その後の定常手順。
フェーズの文脈は `docs/development-logs/20260919_testflight_phase3_phase4.md` を参照。

前提（確認済み）:

- EAS プロジェクト `@yoshi22/courtlens` — ID `a9495214-cd2f-40ae-a32e-ba7e8d517b58`
- Apple Team `7H57MX827T`（Yosuke Muroi / Individual）
- App Store Connect App ID `6769652596`、Bundle ID `com.courtlens.app`
- 設定値はすべて環境変数経由（`app.config.ts`）。キー名は `.env.example` 参照

---

## ① Supabase（動画アップロード先）

これが無いと `app/session/[id]/auto-score.tsx:36` の `CLOUD_ANALYSIS_AVAILABLE` が false になり、
**クラウド解析ボタンが UI から消える**。

### 1-0. 先に決めること — ファイルサイズ上限

| プラン | 1 ファイル上限 |
|---|---|
| Free | **50 MB** |
| Pro | 500 GB |

アプリは無加工のままアップロードする。実測の目安:

| 解像度 | おおよそのサイズ |
|---|---|
| 1080p30 | 約 130 MB/分 |
| 720p30 | 約 45 MB/分 |

加えて `videoUpload.ts` の `VIDEO_UPLOAD_TIMEOUT_MS` は 120 秒なので、WiFi 上り 15Mbps 換算で
現実的に上げ切れるのは **200MB 程度まで**。モバイル回線ならさらに小さい。

**採用した方針: (a) Free のまま 720p の短尺（30〜60 秒）で beta を回す。**

- **アプリ内録画**: `baf7b0e` で `CameraView` に `videoQuality="720p"` を指定済み。
  expo-camera の既定は 1080p で、約 23 秒で Free の 50MB を超えてしまうため。
  720p は `AVCaptureSession.Preset.hd1280x720` = Modal 側の正規化解像度と一致する。
- **ライブラリから選ぶ場合**: 元動画の解像度がそのまま使われる。ベータ検証では
  **iPhone の「設定 → カメラ → ビデオ撮影」を 720p HD/30fps** にしてから撮影する。

見送った案:

- **(b) Supabase Pro**（$25/月）— 長尺を試せるが、120 秒のアップロードタイムアウトは別途効く。
- **(c) アップロード前にトランスコード**（コード変更）— ライブラリ経由の長尺も含めて根本解決する唯一の手。
  ユーザーに解像度設定を強いなくて済む。beta で上記の運用が回らなければ次に検討する。

### 1-1. プロジェクト作成

1. https://supabase.com/dashboard → **New project**
2. Region は **Northeast Asia (Tokyo)** を選ぶ（アップロード遅延に効く）
3. Database Password は任意（このアプリからは使わない）

### 1-2. グローバルのアップロード上限を上げる

Dashboard → **Storage** → **Settings** → *Upload file size limit* をプランの上限まで引き上げる。
バケット側の上限は**このグローバル値を超えられない**ので、先にこちらを設定する。

### 1-3. バケット作成

Dashboard → **Storage** → **New bucket**

- Name: `beta-submissions`（`app.config.ts` の `extra.submission.bucket` と一致させる）
- **Public bucket: OFF**（署名URLで渡すので公開不要）
- Additional configuration → file size limit を設定（例: `50MB` / Pro なら `2GB`）
- Allowed MIME types: `video/mp4`

### 1-4. RLS ポリシー

アプリは anon key だけで叩く（ユーザー JWT は無い）ので、ロールは `anon`。
`videoUpload.ts` は **PUT `/storage/v1/object/{bucket}/{path}`** を使う。この PUT ルートは
storage-api 側で `isUpsert: true` 扱いなので**新規作成も上書きも通る**が、その代わり
**INSERT と UPDATE の両方**のポリシーが要る。さらに署名URL発行（`POST /object/sign/...`）に
**SELECT** が要る。

Dashboard → **SQL Editor** で以下を実行:

```sql
-- アップロード（新規）
create policy "beta anon insert"
on storage.objects for insert to anon
with check (bucket_id = 'beta-submissions' and name like 'analysis/%');

-- アップロード（上書き / upsert 経路）
create policy "beta anon update"
on storage.objects for update to anon
using      (bucket_id = 'beta-submissions' and name like 'analysis/%')
with check (bucket_id = 'beta-submissions' and name like 'analysis/%');

-- 署名URL発行に必要
create policy "beta anon select"
on storage.objects for select to anon
using (bucket_id = 'beta-submissions' and name like 'analysis/%');
```

`analysis/%` に限定しているのは、anon key がアプリバイナリから抜ける以上、
書き込み先をアプリが実際に使うプレフィックスだけに絞るため（`videoUpload.ts` は
`analysis/{clipId}/video.mp4` に置く）。

### 1-5. 値の取得

Dashboard → **Settings** → **API**

- Project URL → `SUPABASE_URL`（例 `https://abcdefgh.supabase.co`）
- Project API keys の **`anon` / `public`** → `SUPABASE_ANON_KEY`
  （**`service_role` キーは絶対に使わない**。RLS を素通りする）

---

## ② Sentry（クラッシュ検知）

### 2-1. プロジェクト作成

1. https://sentry.io → **Projects** → **Create Project**
2. Platform に **React Native** を選ぶ
3. Project name は `courtlens` など

### 2-2. 値の取得

| 値 | 取得場所 |
|---|---|
| `SENTRY_DSN` | Settings → Projects → *courtlens* → **Client Keys (DSN)** の DSN |
| `SENTRY_ORG` | 組織の **slug**。URL の `https://<org-slug>.sentry.io/...` の部分 |
| `SENTRY_PROJECT` | プロジェクトの **slug**（表示名ではなく URL 上の名前） |

slug は表示名と違うことがあるので、必ず URL から取ること。

### 2-3. Auth Token（sourcemap アップロード用）

Settings（組織） → **Auth Tokens** → **Create New Token**
→ **Organization Auth Token**（`sntrys_` で始まる）を作る。sourcemap アップロードに必要な
スコープが最初から入っている。

User Auth Token を使う場合は `project:releases` と `org:read` を付ける。

これが `SENTRY_AUTH_TOKEN`。**EAS には `secret` として登録する**（読み戻せない種類）。

### 2-4. 効き方

- `SENTRY_ORG` と `SENTRY_PROJECT` が**両方**揃って初めて、`app.config.ts` が Sentry Expo プラグインを登録する。
  片方でも欠けるとプラグインごと外れ、ビルドは通るが sourcemap は上がらない。
- `SENTRY_DSN` が空だと `app/_layout.tsx` の `Sentry.init({ enabled: ... && Boolean(dsn) })` で
  実行時に無効化される。
- `SENTRY_AUTH_TOKEN` はビルド時に `sentry-cli` が env から読むだけ。アプリには入らない。

---

## ③ iOS 証明書と App Store Connect

### 3-1. 配布証明書 / Provisioning Profile

```bash
eas credentials --platform ios
```

プロンプトの進み方:

1. **Select build profile** → `production`
2. **What do you want to do?** → *Build Credentials* → **All: Set up all the required credentials to build your project**
3. Apple アカウントへのログインを聞かれる → Apple ID + パスワード + 2FA コード
4. Team は `Yosuke Muroi (Individual) (7H57MX827T)` を選ぶ
5. Distribution Certificate と Provisioning Profile（`com.courtlens.app`）が自動生成され、EAS に保存される

一度作れば以後のビルドで再利用される。

### 3-2. App Store Connect API Key（任意だが推奨）

無くても `eas submit` は Apple ログインで通るが、毎回 2FA を打つことになる。

同じ `eas credentials` メニューの **App Store Connect: Manage your API Key** から
EAS に作らせるのが一番早い（Apple にログイン済みなら自動生成される）。

手動で作る場合: App Store Connect → **Users and Access** → **Integrations** → **App Store Connect API**
→ キーを生成（Role: *App Manager* 以上）→ `.p8` をダウンロード（**再ダウンロード不可**）。
Key ID と Issuer ID も控える。

### 3-3. Apple ID の確認

`eas.json` の `submit.production.ios.appleId` は `muroi.y22@gmail.com`。
EAS アカウントのメール（`muroi.yosuke22@gmail.com`）と違うので、
**Apple Developer Program に登録しているのがどちらか**を確認して、違っていれば `eas.json` を直す。

---

## ④ EAS への登録

取得した値を EAS の `production` 環境に入れる。
（Web からでも可: https://expo.dev/accounts/yoshi22/projects/courtlens/environment-variables）

```bash
eas env:create production --name SUPABASE_URL        --value "https://xxxx.supabase.co" --visibility sensitive --non-interactive
eas env:create production --name SUPABASE_ANON_KEY   --value "eyJ..."                  --visibility sensitive --non-interactive
eas env:create production --name SENTRY_DSN          --value "https://...@o0.ingest.sentry.io/0" --visibility sensitive --non-interactive
eas env:create production --name SENTRY_ORG          --value "your-org-slug"           --visibility sensitive --non-interactive
eas env:create production --name SENTRY_PROJECT      --value "courtlens"               --visibility sensitive --non-interactive
eas env:create production --name SENTRY_AUTH_TOKEN   --value "sntrys_..."              --visibility secret    --non-interactive
```

`visibility` の使い分け:

- **`sensitive`** — ビルド中に `app.config.ts` から読めて、ダッシュボードでは伏字。上の 5 つはこれ。
- **`secret`** — 二度と読み戻せない。`SENTRY_AUTH_TOKEN` のように
  「ビルド環境に居ればよく、設定ファイルから読む必要がないもの」だけ。
  `app.config.ts` が読む値を secret にすると**空文字になって静かに壊れる**。

ローカル開発用には同じ値を `.env.local` に置く（git 管理外）。`.env.example` をコピーして埋める。

確認:

```bash
eas env:list production
npx expo config --type public --json | python3 -c "import json,sys;c=json.load(sys.stdin);print(c['extra']['submission'])"
```

---

## ⑤ ビルドと提出

```bash
npm run type-check && npm run lint && npm test   # 必ず先に
npx expo-doctor                                   # 17/17 であること
npm run build:ios                                 # eas build --platform ios --profile production
npm run submit:ios                                # eas submit --platform ios --profile production --latest
```

- ビルドログで `Uploading source maps` が成功しているか確認する。
- 提出後、App Store Connect で「処理中」→「テスト準備完了」まで 5〜30 分。
- 輸出コンプライアンスは `ITSAppUsesNonExemptEncryption: false` で自動回答済み。
- **Internal Testing** グループにテスターを追加（Beta App Review 不要、即日配信）。

次のビルドでは `app.config.ts` の `ios.buildNumber` を手で上げる
（`appVersionSource: "local"` かつ dynamic config なので EAS は自動採番しない）。
