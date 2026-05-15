# Data Model

## TennisSession

`TennisSession` は、試合または練習のまとまりを表す中心モデルです。

共通フィールド:

- `id`: セッション ID。
- `title`: ユーザーが入力するセッション名。
- `sessionType`: `match`、`serveTraining`、`strokeTraining`、`volleyTraining`、`freeTraining`。
- `matchFormat`: `singles` または `doubles`。
- `opponentName`: 対戦相手または練習相手名。
- `videoUri`: 端末内の動画 URI。
- `points`: `PointRecord[]`。
- `note`: セッションメモ。
- `startedAt` / `endedAt` / `createdAt` / `updatedAt`: ISO 8601 文字列。

## HardTennisSession / SoftTennisSession

`TennisSession` は discriminated union として定義されています。

```ts
export interface HardTennisSession extends BaseSession {
  sport: 'tennis';
}

export interface SoftTennisSession extends BaseSession {
  sport: 'softTennis';
  position?: SoftTennisPosition;
}

export type TennisSession = HardTennisSession | SoftTennisSession;
```

設計意図:

- `sport` を判別キーにして、硬式とソフトテニスの分岐を型安全に扱う。
- v0 では共通のセッション構造を保ちつつ、ソフトテニス固有フィールドを `SoftTennisSession` に閉じ込める。
- 将来、前衛/後衛ロール、ペア、陣形、ポーチなどをソフトテニス側だけに追加しやすくする。
- UI や分析 service は、共通フィールドを使う範囲では `TennisSession` のまま扱える。

現状の `SoftTennisPosition` は `forehand` / `backhand` のサイド情報として定義済みです。前衛/後衛の戦術ロール分析は未実装で、今後の拡張対象です。

## PointRecord

`PointRecord` は、1 ポイントまたは練習球 1 本分の記録です。

- `id`: ポイント ID。
- `sessionId`: 所属するセッション ID。
- `timestamp`: 記録時刻。
- `outcome`: `won` または `lost`。
- `serveResult`: `firstIn`、`secondIn`、`doubleFault`、`ace`、`returnError`。
- `shotType`: `serve`、`forehand`、`backhand`、`volley`、`smash`、`lob`、`drop`。
- `resultReason`: `winner`、`forcedError`、`unforcedError`、`net`、`out`。
- `rallyCount`: ラリー数。
- `shotLocation`: コート上の打球位置。`x` / `y` は 0..1 の正規化座標。
- `targetLocation`: 狙った位置。v0 では型として用意され、主に将来分析用。
- `videoTimestamp`: 動画内の秒数。将来の動画同期用。
- `note`: ポイントメモ。

## PlayerProfile

`PlayerProfile` は、プレイヤーの基本設定です。

- `id`: プレイヤー ID。
- `name`: プレイヤー名。
- `sport`: `tennis` または `softTennis`。
- `playStyle`: `baseline`、`serve-volley`、`allcourt`。
- `dominantHand`: `right` または `left`。
- `createdAt` / `updatedAt`: ISO 8601 文字列。

v0 では設定画面で保存し、将来の分析コメントの個別化に利用する前提です。

## WeaknessPattern と CoachingRule

`WeaknessPattern` は、ManualAnalyzer が検出する弱点の識別子です。

- `highDoubleFault`
- `lowFirstServeIn`
- `shortRally`
- `weakBackhand`
- `weakVolley`
- `frequentUnforcedError`
- `poorNetApproach`

`src/data/coachingRules.ts` では、弱点ごとに `tips` と `drills` を持つ `CoachingRule` を定義しています。

```ts
export interface CoachingRule {
  tips: CoachingTip[];
  drills: PracticeDrill[];
}

export const coachingRules: Record<WeaknessPattern, CoachingRule> = { ... };
```

流れ:

1. `ManualAnalyzer` がポイント配列から `WeaknessPattern[]` を作る。
2. `generateCoachingTips` が弱点を `CoachingTip[]` に変換し、優先度順に並べる。
3. `generatePracticeMenu` が弱点を `PracticeDrill[]` に変換し、所要時間順に並べる。
4. レポート画面が Tips と Drill を表示する。

## AsyncStorage キー設計

- `courtlens-sessions`: `useSessionStore` のセッション配列を保存する。
- `courtlens-player-profile`: `usePlayerStore` のプロフィールを保存する。

キー名はアプリ名の接頭辞 `courtlens-` を付け、データ領域を明確に分けています。将来クラウド同期へ移行する場合も、このキー単位で移行処理を設計できます。
