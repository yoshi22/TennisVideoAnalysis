# 2026-09-13: TrackNet+軌跡でボール検出を実証 / 8GB OOM で計算が頭打ち / 次は Modal

(前日ログ `20260912_pivot_vlm_labeling_rfdetr_shot_coaching.md` の続き)

## 達成したこと(経路B = ボール軌道追跡)

1. **モデル判断を実証で確定: RF-DETR は不適 → TrackNet + 軌跡処理**
   - RF-DETR(ViT patch16)は解像度320で ball mAP=0。**5pxボール < 16pxパッチ=サブパッチで見えない**構造的限界を実証。高解像度は要 GPU。
   - TrackNet(CNNヒートマップ)はゼロショットで既に我々の遠景720p素材のボールを検出。
2. **「動画=軌跡として捉えればボールを追える」を実データで証明(核心デリスク突破)**
   - ゼロショット TrackNet 出力を **軌跡リンク+外れ値棄却+内挿**(`trajectory_process.py`)で処理 → **クリーンなボール軌跡**。
   - 密推論(stride2/15fps)で **rally13 = 被覆98.9%**、サーブの弧・ラリー往復が明確。誤検出(フェンス等)は軌道から外れて自動棄却。
   - 単フレーム評価(RF-DETR/VLM)が失敗したのは「見る角度」の誤りで、**時間軸で見れば成立**。
3. **V4 学習基盤 整備・独立検証済**(`scripts/eval/tracknet_v4/{model,dataset,train}.py`、self-test: 入力(1,9,288,512)→出力(1,3,288,512)、11.3Mパラメータ、backward動作)。※V4は精度天井だが**事前重み無し=データが揃ってから学習**。
4. **モデル/Astra 方針**: 検出=TrackNet(V1で着手→データが揃えばV4)。Astra は OpenAI API 課金が必要(ChatGPTサブスク≠API)で任意ブースター。GT主生成は無償のTrackNet教師+軌跡。

## 作成した資産(すべてリポ内・再開可能)

- 自動ラベリング/軌跡: `scripts/eval/autolabel/{blob_candidates,generate,bootstrap_ball_gt,viz_trajectory,trajectory_process,build_ball_gt_from_track,expand_gt_pipeline,expand_gt_framemode.sh}.py/sh`
- V4学習: `scripts/eval/tracknet_v4/{model,dataset,train}.py` + README
- RF-DETR(不採用だが残置): `scripts/eval/rfdetr/{build_coco,train,eval_pe,_compat}.py`、隔離venv `.venv-rfdetr`
- GT: `eval/datasets/fixed-camera-v2/ball-gt/`(muko-clip1=426点、gr4ves=14点部分)
- クリーン軌跡+トレイル画像: `eval/datasets/fixed-camera-v2/ball-tracks/tracknet-v1/clean/`
- 実装の大半は **codex(MCP)委譲**でトークン節約。

## ⛔ ブロッカー: 8GB RAM で ML 計算が OOM kill

- 本機は**物理メモリ8GB**。VS Code+Chrome+MCP群+Claude で圧迫(空き~43%、スワップ 3.8G/5.1G)。
- **TrackNet 推論のバックグラウンド実行が起動数分で OOM 回収**(video/frame両モードとも、~500〜2300フレームで kill)。muko が完走したのは初期のメモリ余裕時のみ。
- GT データ拡張(残り6クリップ)が完走できない根本原因。**V4学習は推論よりメモリを食うので8GBローカルでは事実上不可**。
- 教訓: **重い推論/学習はローカル8GBでは不可 → クラウド(Modal)が必須**。

## 次のステップ: Modal(クラウドGPU)へ移行

- 理由: 8GB制約を完全回避。計画の想定スケール路。既存 `scripts/eval/modal_train.py`(rally_state用)がテンプレートとして流用可。
- Modal 上で回すもの:
  1. **全クリップの密推論**(TrackNet、frame or video)→ 軌跡 → GT(データ拡張)。
  2. **V4 学習**(拡張GTで)。
- 必要準備は別途整理(Modalアカウント/token、GPUイメージ、データVolumeアップロード、実行スクリプト)。

## 再開手順(要約)

1. Modal 準備(下記チェックリスト)。
2. データ(clips or frames + 既存GT)を Modal Volume へアップロード。
3. Modal 上で GT 拡張 → V4 学習 → 成果物(重み・GT・メトリクス)をダウンロード。
4. ローカルで PE 評価・可視化(軽いので8GBで可)。

## 注記

- Phase B0 の**核心デリスクは達成**(ボールは軌跡として追える)。残るはデータ拡張とV4学習=計算資源の問題で、Modalで解く。

## 追記(同日): Modal で GT 拡張成功 — 426 → 5,746点

- Modal(T4 GPU)で GT 拡張を実行。8GB OOM を完全回避。
- 結果(6クリップ、lm5yzwr8lsw と qtrjfrca3z0 は0ラリーのため除外):
  - 61l1sw26dtg=2119, na9s4gjzel0=1282, 29hnqxtyuzm=1097, aiax=808, muko=426, gr4ves=14 → **合計 5,746点**
- Modalの学び:
  - volume put の remote パスは `/data` を付けない(mount=/data=volume root。二重ネスト注意)。
  - 逐次処理は関数 timeout(3600s)超過→timeout=10800へ。
  - ローカル `modal run` が落ちるとアタッチ中のクラウドjobがキャンセル → **`modal run --detach`** で切り離す(各クリップは volume に逐次commit=進捗保持)。
  - 高速化余地: クリップごとに並列(.map/.spawn)にすれば大幅短縮。
- アプリ: `scripts/eval/modal_ball.py`(upload/expand/train/download)。VOLUME=tennis-ball-v0。
- 次: V4学習前に GT該当フレームを volume に抽出 → `train`(detach)→ download → ローカルでPE評価。

## 追記2(同日): V4 学習成功 & held-out 評価で median 4.6px

- Modal(deploy+spawn)で V4 学習(5クリップ・5,320点GT、muko除外=mp4無し)。**root cause=8GBがmodalクライアントをkill→リモートjobキャンセル。deploy+spawnで完全独立化して解決。**
- **held-out muko(学習未使用)で PE 評価(中間チェックポイント)**:
  - 検出率97.7% / **中央値 4.6px** / 10px以内76% / 20px以内84% / 5px以内54%
  - 目視: 多数フレームでボールに正確(例 frame11280 d=4px)。外れ値~15-25%は背景/選手に飛ぶ→軌跡処理で除去可。教師GT自体の誤りも一部あり(consistency check)。
- **= 経路B 核心「ボール検出器の確立」実質達成**(汎化・実学習を確認)。
- 資産: `scripts/eval/tracknet_v4/eval_pe.py`(ローカル評価)、`eval/results/tracknet-v4-modal/{latest.pt, pe-eval-muko/}`。
- 次: 学習完了で最終重み取得→再評価。その後 Phase B2(軌跡→ショットイベント: 速度/コース/打点)へ。

## 追記3(同日): Phase B0 完了 — 早期終了で確定

- V4 学習を held-out PE でモニタリング。推移: epoch8=4.6px, epoch9=5.5px, epoch12=5.85px(train lossは0.0167→0.0144と低下継続)。
- **train loss 低下 vs held-out PE 頭打ち = 過学習入口 → 早期終了トリガー成立**。epoch12 で学習打ち切り(modal app stop、コスト節約)。
- **最終モデル: `eval/results/tracknet-v4-modal/latest.pt`(epoch12, 5クリップ学習)**。held-out muko で median ~5px・10px以内74%・検出率98%。外れ値はmean改善(38→28px)で減少傾向、残りは軌跡処理で除去可。
- **Phase B0(ボール検出器の確立)完了**。学び: 早期終了+高速I/Oを次回入れる。30epochは過剰、実質~10epochで収束。
- 次: **Phase B2(軌跡→ショットイベント: 速度/コース/打点)**。既存 trajectory_process + serveSpeed + bounceDetect + homography移植 で構築。

## 追記4(同日): Phase B2 着手 — ショットイベント pipeline 骨格完成

- 新規 `scripts/eval/shot_events/pipeline.py`(codex作成、self-test通過)。軌跡→cv2ホモグラフィ→バウンド/打点→コース(俯瞰座標)→速度→ショット集約+可視化(軌跡オーバーレイ/俯瞰コート図)。
- コート較正: `eval/datasets/<ds>/court/<clip>.json`(image_corners 4点 ↔ court_corners_m 4点)。muko は概略4隅で作成。
- muko 初回実行: events=34(bounce0/contact34)、peak_kmh=293.7(非現実)、俯瞰図・オーバーレイ生成。
- **骨格は一気通貫で機能**。要調整: (1)精密コート較正(速度スケール)、(2)軌跡をV4出力へ差替+外れ値除去、(3)ラリー毎ショット分割(オーバーレイのスパゲッティ解消)、(4)バウンド/打点判定チューニング。
- 資産: `eval/results/shot-events/<clip>.{json,_trajectory.jpg,_court.jpg}`。

## 追記5(同日): B2 refine round1 — ラリー毎ショット+バウンド着地マップが可視化

- pipeline.py 改良: ラリー毎分割(overlay 18枚)、速度外れ値フィルタ(--max-speed-kmh/--max-jump)、バウンド判定調整。
- muko結果: 18ラリー、バウンド16、速度 中央値49km/h(現実的)・peak249(キャップ、残外れ値あり)。
- **rally13 overlay = クリーンな往復軌跡+バウンド4点。俯瞰図=ラリー毎バウンド着地マップ**(サービスボックス/ベースライン分布)= 「コース」プロダクト出力が実データで可視化。
- **= ショット毎コーチングのデータ基盤(検出→軌跡→ショット→着地/速度)が一気通貫で動作**。
- 残refine: 精密コート較正(placement/速度の絶対精度)、軌跡をV4出力へ差替、peak速度の残外れ値、バウンド判定の更なる調整、B3(ストローク種別/打点フォーム=姿勢統合)。

## 追記6(同日): B2 全refine + B3 実質完成

- **B2 bounce/contact 抜本改善**(codex, min-gap/速度sign-change): muko で contacts 2→**52**, bounces **27**。rally13=13contacts/6bounces(現実的)。速度 median 40-64km/h・p95 147-207km/h。
- **B3 姿勢統合**(`scripts/eval/shot_events/stroke_pose.py`, YOLO11n-pose): 52contact→ forehand10/backhand9/unknown33。打点フレームにスケルトン+FH/BHラベル描画。unknownは奥選手が小さく検出不可(既知制約)。
- **= B2(検出→軌跡→ショット→着地/速度)+ B3(FH/BH+打点フォーム)が一気通貫で動作**。
- 既知の限界(後段refine候補): (1)コート較正が概略(placement/速度の絶対精度)、(2)V4軌跡はローカルCPU 22s/frameで非現実→Modal GPU必須(未実施)、(3)FH/BH unknown率(奥選手)、(4)serve/volley等の種別未分化。
- 資産: `scripts/eval/shot_events/{pipeline,stroke_pose}.py`、`eval/results/shot-events/`。

## 追記7(同日): B4 配置判断の設計メモ

- パイプライン(検出→軌跡→ショット→着地/速度/FH-BH)は Python(Modal/ローカル)で完成。アプリ搭載の配置は2択:
  - **A クラウド推論(推奨・まず出荷)**: 動画アップ→Modalで解析→ショットJSON返却→アプリ表示。動くPython再利用で最速。**解析毎にGPUコスト**(T4で1試合~数分=概算 $0.05〜0.15/解析)+アップロード/保存。
  - **B オンデバイス**: V4を CoreML/TFLite化+ロジックTS移植。オフライン/プライバシー/課金無し。工数大・端末fpsリスク。
- **A→B の後日切替は現実的**(標準的な cloud-first→edge 戦略):
  - R&D(モデル・パイプライン)はそのまま流用可、切替は"実行場所の移植"であり科学の再実施ではない。
  - 既存イネーブラ: react-native-fast-tflite(MoveNet on-device実績)、calibration.tsx(4隅→homography)、PointRecord(draft対応)。
  - 切替トリガー: 解析コストが規模で無視できなくなった時 / オフライン・プライバシー要件 / モデルが安定して"凍結"できる時。
  - 主リスク: 端末での毎フレームV4推論fps(切替時に要検証)。
- 共通のアプリ統合設計: ショット出力→PointRecord draft、report.tsx/coachingRules.ts をショット毎コーチングに拡張、較正は既存UI流用。
- **B4 実装は配置決定+実機確認が前提**(自動で閉じない境界)。

## 追記8(同日): 配置=cloud-first 確定 + 収益設計を記録

- 配置戦略確定: **cloud-first → 補正フライホイールでデータ蓄積 → 将来 edge 移行**。詳細は `docs/product-strategy-monetization.md`(重要ドキュメント)+ メモリ `project-cv-shot-analysis-pivot`。
- 料金: サブスク+フェアユース上限(スタンダード¥980〜1,480、ミドル利用で粗利~75%)。COGS≒$0.1-0.2/解析。edge化で原価≒0。
- B4 実装方針: **Modal を「動画→ショットJSON」解析APIとして整備**(V4推論はGPU必須なのでここで解決)→ アプリ統合(PointRecord draft / report / 較正UI流用)は配置決定後にRN側で。

## 追記9(同日): B4 cloud-first 解析エンドポイント実装(Modal `analyze`)

cloud-first の中核=「動画→ショットJSON」クラウド解析パイプラインを Modal 上に実装・デプロイ。

- **欠けていた部品を新規実装**: `scripts/eval/tracknet_v4/infer_trajectory.py`。eval_pe.py は GT フレームだけを採点するが、これは **学習済み V4 を全フレームに適用**し `ball-tracks/tracknet-v4/<clip>.jsonl`(track-ball.py と同スキーマ: frameIdx/timeSec/x/y/visible/confidence, x,y 正規化)を書き出す。3フレーム9ch・288×512・sigmoid(logits[0,1]) の argmax。フレームキャッシュで各フレーム1回読み。
- **Modal `analyze` 関数**(`scripts/eval/modal_ball.py`, gpu=T4, memory=16384, timeout=10800, `analyze_image`=base+ultralytics): 1) clip mp4 から 30fps フレーム抽出 → 2) infer_trajectory(V4/cuda)→ 3) trajectory_process(clean)→ 4) shot_events/pipeline(速度/コース/バウンド/打点)→ 5) stroke_pose(FH/BH, yolo11n-pose 自動DL)→ shot-events JSON を返す。`labels/<clip>.json`(ラリー窓)と `court/<clip>.json`(較正)が volume 上に必要。
- 実行は deploy+spawn(ローカルclient死でキャンセルされる罠回避)。CLI: `python scripts/eval/modal_ball.py analyze --clip-id <clip>`(local_entrypoint `analyze_clip` / deployed `analyze`)。
- **検証run**: gr4ves-ntp4-clip1(volume に mp4/DRAFTラベル17ラリー有り)。court 較正が無かったため**近似較正を新規作成** `court/yt-gr4ves-ntp4-clip1.json`(急角度アマ動画を目視・netが court-y≒13m/true11.9, x中心≒4.1m にマップされる程度の近似。**精密較正は B2 の繰越課題**)。
- 注意: production ではラリー窓検出(auto rally-detect)と較正をアプリ/前段が供給する必要。今回のエンドポイントは eval データ構造(labels+court on volume)前提での cloud チェーン疎通検証。

### 検証結果(gr4ves フルクリップ 600秒 / 18,002フレーム, T4)
- **エンドツーエンド成功**。V4推論 18,002フレーム→ボール検出 9,210(検出率~51%, 遮蔽/画面外込みで妥当)。推論スループット **~22fps@T4**(COGSの律速; 将来バッチ/strideで半減可能)。
- 出力: **17ラリー / 279イベント(バウンド113 + 打点166)/ 速度サンプル4,202**。FH/BH: forehand 22, backhand 23, unknown 121。
- **可視化で軌道追跡が機能していることを確認**(例 rally04: 193点・192リンクが青→赤で court を横断、バウンド/打点マーカーが妥当な折返し点に配置)。成果物 `eval/results/shot-events/yt-gr4ves-ntp4-clip1{.json,_strokes.json,_rallyNN.jpg,_court.jpg}`。
- **既知の精度課題(繰越)**: 速度が過大(median 47km/h だが raw_max 3001 / p95 200km/h)。主因=**近似コート較正**+検出ジッタ由来の大ジャンプ。→ 精密較正(B2 refine)と検出平滑化で解消見込み。FH/BH unknown 73% も B3 の繰越(遠景プレイヤーの pose 取りこぼし)。
- 運用メモ: (1) analyze は毎回 30fps 密フレームを再抽出(学習用の疎フレーム混入を防止)。(2) held-out の gr4ves mp4 が volume 上で ~31フレームしかデコードできず再アップロードで解消(バイトサイズは正常だった=部分破損)。(3) `modal volume get <dir>` は既存ローカルdirがあると1階層ネストする癖あり(手動で flatten)。

### B4 の残り(RN アプリ統合 = ユーザー関与の境界)
cloud 解析APIは完成。次はアプリ側: ショットJSON→`PointRecord`(source:'auto', reviewStatus:'draft')投入 / レポートをショット毎コーチングへ再設計(`report.tsx`, `coachingRules.ts`)/ 較正UI(`calibration.tsx`)流用 / 補正フライホイールの draft→confirmed 保存。実機検証を伴うため次段でユーザーと。

## 追記10(同日): 最短E2E — 解析APIをデータ駆動+HTTP化、アプリ側クライアント実装

方針決定: **最短の“動くE2E実機検証”**(A項目のみ+ラリー窓はアプリ同送+Supabase経由+固定カメラ)を優先実装。契約は `docs/cloud-analysis-api.md`(重要)。

**クラウド側(完成・検証済)**:
- `analyze` を**データ駆動化**: コート4隅(正規化[0,1])+ラリー窓 `[{startSec,endSec}]` を引数で受け、サーバ側で court/labels JSON を自動生成(事前手ラベル不要に)。`_write_court_json`/`_write_labels_json` 追加。
- **実機動画正規化**: フレーム抽出時に `scale=1280:720,fps=30`(回転はffmpeg自動適用、~16:9横向き固定カメラ前提)。`_extract_all_frames(normalize=True)`。
- **video_url ダウンロード**対応(アプリが署名URLを渡せる)。
- **HTTP エンドポイント**(`@modal.fastapi_endpoint`, `web_image`): `POST submit`(→call_id)/ `GET result?call_id=`(running|done|error+payload)。URL: `https://yoshi22--tennis-ball-{submit,result}.modal.run`。
- 検証: gr4ves で HTTP 疎通OK、データ駆動で **17ラリー/279イベントを同一再現**(手ラベル無しで)。

**アプリ側(実装・type-check/lint通過、実機結線は次段)**:
- `src/services/analysis/cloudAnalyze.ts`: submit/poll クライアント + レスポンス型(config は `expo.extra.cloudAnalysis`)。
- `src/services/scoring/cloudCandidates.ts`: ショットJSON → `AutoPointCandidate[]`(ラリー毎、FH/BHはstrokes結合、速度/ゾーンをdiagnosticsに)。→ 既存 `buildDraftPointFromCandidate` → draft `PointRecord` → 既存 `auto-score.tsx`/`AutoPointCard` レビューUI(=補正フライホイール)にそのまま乗る。

**実機E2Eの残り(ユーザー関与)**: (1) `expo.extra` に cloudAnalysis + submission 設定、(2) 較正UIの4隅→正規化corners結線、(3) rallySegment→窓、(4) uploaderで動画URL取得、(5) auto-score画面から `runCloudAnalysis`→`cloudResultToCandidates` 呼び出し、(6) 実機実行。手順は `docs/cloud-analysis-api.md` の「アプリ側の結線」。
- 留意(繰越): レイテンシ ~13分/10分クリップ(短尺 or ラリー窓のみ推論が必要)、速度精度は較正依存、FH/BH unknown、勝敗は自動判定不可(レビューで確定)、エンドポイント無認証(ベータ用)。

## 追記11(同日): アプリ結線を「実機実行の手前」まで完了

`auto-score.tsx` にクラウド解析パスを追加し、実機で撮影→ボタン一発でクラウド解析→レビューまで通る状態に(実機実行=ユーザーのみ)。type-check / lint / 新規テスト 全通過。

- **新規 `src/services/analysis/videoUpload.ts`**: 動画を Supabase Storage(既存 `expo.extra.submission` 設定を流用)に PUT →**署名URL**を発行して返す(Modal の urllib はヘッダ無しで取得するためトークンはクエリに乗せる必要)。
- **`auto-score.tsx` 結線**: `handleCloudAnalyze` 追加。既存 `detectRallyWindows`(オンデバイス)でラリー窓 → `courtCalibration.imageCorners`(既に near-left..far-left 正規化で契約一致)→ 動画アップロード → `runCloudAnalysis` → `cloudResultToCandidates` → 既存 `candidates` state に投入 = 既存レビューUI/ドラフト保存(補正フライホイール)にそのまま乗る。ボタンは `expo.extra.cloudAnalysis` と submission 設定が揃うと出現。
- **設定**: `app.json` の `expo.extra.cloudAnalysis` に本番 submit/result URL を追加済。`submission.url`/`anonKey` は**ユーザーが Supabase 値を投入**(空だとクラウドボタン非表示・既存オンデバイス採点は従来通り動作)。
- **テスト**: `__tests__/services/scoring/cloudCandidates.test.ts`(ラリー毎マッピング/優勢ストローク/placeholder/空events)。

**実機実行に残るのはユーザー作業のみ**: (1) `app.json` の `submission.url`/`anonKey` に Supabase 値を設定 + 対象バケットで署名URL発行が可能なこと、(2) dev build で起動し、セッションに動画取り込み→コート較正→「クラウドでショット解析」ボタン→レビュー。手順は `docs/cloud-analysis-api.md`。

## 追記12(同日): レイテンシ改善 — V4推論を 780s→471s(同一結果)/ 252s(高速)

ボトルネックは**GPUではなく JPEG デコード(CPU単スレッド)**だった(batch16単体では 22→15fps と逆に悪化して判明)。効いた順に実装(`infer_trajectory.py`):
1. **DataLoader 並列デコード**(`--num-workers`, Modal は `cpu=8.0`)= 15→**30fps**(デコードをGPUと重ねる。最大の効き)。
2. **ラリー窓内のみ推論**(`--windows-json`, labels流用): gr4ves 18003→11037フレーム(死に時間を除外)。**下流はラリー窓でトリムするので結果は不変**。
3. **バッチ推論**(`--batch-size 16`)+ `--stride` ノブ。

計測(gr4ves 600秒クリップ, T4):

| モード | 実時間 | events(bounce/contact) | speed中央値/p95 |
|---|---|---|---|
| 原始(full-clip単フレーム) | ~780s(13分) | 279 (113/166) | 47/200 |
| stride1(窓+batch16+workers8) | **471s(7.9分)** | 279 (113/166) **同一** | 47/200 |
| stride2 | **252s(4.2分)** | 219 (87/132) 約8割 | 50/197 |

- stride1 は**結果完全同一**で1.65×高速(窓で捨てたのは死に時間フレームのみ)。stride2 は2倍速だが 15fps サンプリングで速いイベントを~20%取りこぼす。
- **デフォルト stride=1(精度優先)**。`analyze` 既定 batch=16 / workers=8。高速モードとして stride=2 を選択可(web submit で `stride` 受け渡し可能)。
- 現実的なUX指針: 10分試合フルは ~4-8分。**near-interactive には短尺(1-2ラリー/1ゲーム)推奨**(1分クリップなら stride1 でも ~1分前後)。さらなる高速化レバー = 大型GPU(L4/A10G)や extraction を窓内のみに限定。

## 追記13(同日): 速度精度 — ジッタ増幅の除去(3000→現実域)+ 幾何限界の明示

**原因切り分け(実データ)**: 中央値47km/hは妥当だが裾が過大(p95 200, p99 236, raw最大3001)。裾は「1フレーム33msで1.5〜2.3m移動」=**遠景での数pxジッタが遠近変換で数mに増幅**。全体スケール(較正)ずれではなく**ジッタ×遠近**が主因と判明。

**対策(`shot_events/pipeline.py`, GPU不要でローカル反復して検証)**:
1. **位置平滑化**(`--speed-smooth-window` 既定2)。
2. **複数フレーム窓での速度**(`--speed-window-frames` 既定3): フレーム間差分(ノイズ増幅)を廃し、窓の端点間の court 距離/dt。
3. **場外棄却**(`--speed-court-margin-m` 既定4m): コート外に飛ぶノイズ検出を除外。
4. **ショット速度を頑健化**: `local_event_speed` を max → **近傍サンプルの75パーセンタイル**(打点直後の単発ノイズスパイクに引きずられない)。
5. `--max-speed-kmh` 既定 250→200。

**効果(gr4ves, 同一clean軌跡)**:
| 指標 | 修正前 | 修正後 |
|---|---|---|
| speed全サンプル p95 | 200 | **157** |
| 同 中央値 | 47 | 29 |
| raw最大 | 3001 | 359 |
| 打点速度 中央値 | 78 | **63** |

**残る幾何限界(正直に明記)**: 打点速度の 160-200km/h 帯(約2割)は**単発ジッタではなく系統誤差**。地面平面ホモグラフィは**空中のボールを実際より遠くに射影**(カメラ手前ほど大)→ 空中球の絶対速度を過大評価する。統計では消せない。→ 出力 JSON の caveats に明記し、アプリ診断も「速度(目安)」表記に変更。**根本解は (a) 各ユーザーの精密較正 +(b) 将来のボール高さ(3D)推定**。現状は相対指標として提示するのが誠実。
- 変更をボリュームへ反映済(cloud endpoint も改善版 pipeline を使用)。type-check/lint/self-test 通過。

## 追記14(2026-09-14): 動画解析→ラリー履歴(コース)永続化 + スコア自動下書き(確認式)

「手動でなく動画からスコア/ラリー履歴(コース等)を記録したい」への実装。**解析は既存クラウド基盤で生成済み**なので、不足していた「永続化・閲覧・勝敗の扱い」を追加。コミット `51aff3e`。

**設計判断**:
- ラリー履歴(コース/速度/FH-BH/バウンド)は動画から**確実に記録可能** → 型+保存+閲覧UIを追加。
- スコア**完全自動**は単眼・近似較正では勝敗判定(イン/アウト・返球可否)の信頼度が低い → **「自動推定→1タップ確認」**を採用(補正フライホイールと同思想。確認データ蓄積で将来自動化)。

**実装**:
- 型 `src/types/rallyAnalysis.ts`:`RallyAnalysis/RallyRecord/ShotRecord`。`session.rallyAnalyses[]` に永続化(`BaseSession` へ追加)。ショット毎に stroke(FH/BH/serve)・コース(zone+コート正規化座標)・速度(目安)・バウンド位置。
- ロジック `src/services/analysis/rallyHistory.ts`:`cloudResultToRallyAnalysis`(shot-events→履歴)、`inferRallyOutcome`(最後のバウンドのイン/アウト×プレイヤー側→低信頼の勝敗推定, confidence≤0.45)。
- ストア `sessionStore`:`addRallyAnalysis` + `confirmRallyOutcome`(確認で**確認済み自動 `PointRecord` を upsert / unknown で削除** → 既存スコア・スタッツ計算に合流)。
- 画面 `app/session/[id]/rally-history.tsx`:サマリ + バウンドのコースマップ(`CourtHeatmap`)+ ラリー別カード(ショット一覧・コース・速度・勝ち/負け/未定トグル)。auto-score のクラウド経路は解析後にこの画面へ遷移。
- `cloudAnalyze.ts` に `CloudBounce` 型を追加(bounces を型付け)。

**検証**:
- ユニット:`rallyHistory`(マッパー+勝敗推定)、`sessionStore.rallyAnalysis`(確認→ポイント生成/更新/削除)。**全体 147 テスト通過**、type-check/lint OK。
- 実機シミュレーター(Appium/testID 自動操作):s001 にサンプル `rallyAnalyses` を注入 → rally-history 描画(コースマップ+ラリーカード)確認 → 「負け」タップ → ラリー1が「確認済/負け」に更新 → AsyncStorage に確認済みポイント(outcome:lost, rallyCount:3)生成を実証。
- 検証用の一時 Redirect は revert 済(コミットに未混入)。

**残り**:実機E2E(実 Supabase 設定+実動画)。実ラリーが検出される動画では ラリー検出→クラウド解析→本履歴画面→確認→スコア化 まで一気通貫。
