import { type PointOutcome, type ResultReason } from '@/types/point';
import { type SessionType } from '@/types/session';
import { type WeaknessPattern } from '@/types/analysis';

export const WEAKNESS_LABELS: Record<WeaknessPattern, string> = {
  highDoubleFault: 'ダブルフォルトが多い',
  lowFirstServeIn: 'ファーストサーブ成功率が低い',
  shortRally: 'ラリーが短く終わりやすい',
  weakBackhand: 'バックハンドで失点が多い',
  weakVolley: 'ボレーで失点が多い',
  frequentUnforcedError: '凡ミスの割合が高い',
  poorNetApproach: 'ネットプレーの展開が少ない',
};

export const RESULT_REASON_LABELS: Record<ResultReason, string> = {
  winner: 'ウィナー',
  forcedError: '誘ったミス',
  unforcedError: '凡ミス',
  net: 'ネット',
  out: 'アウト',
};

export const OUTCOME_LABELS: Record<PointOutcome, string> = {
  won: '得点',
  lost: '失点',
};

export const SESSION_TYPE_LABELS: Record<SessionType, string> = {
  match: '試合',
  serveTraining: 'サーブ練習',
  strokeTraining: 'ストローク練習',
  volleyTraining: 'ボレー練習',
  freeTraining: '自由練習',
};
