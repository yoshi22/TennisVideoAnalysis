import { type ShotType } from '@/types';

export const FORM_ANALYSIS_SHOT_OPTIONS: { label: string; value: ShotType }[] = [
  { label: 'サーブ', value: 'serve' },
  { label: 'フォア', value: 'forehand' },
  { label: 'バック', value: 'backhand' },
  { label: 'ボレー', value: 'volley' },
  { label: 'スマッシュ', value: 'smash' },
];

export const FORM_ANALYSIS_SHOT_LABELS: Record<ShotType, string> = {
  serve: 'サーブ',
  forehand: 'フォアハンド',
  backhand: 'バックハンド',
  volley: 'ボレー',
  smash: 'スマッシュ',
  lob: 'ロブ',
  drop: 'ドロップ',
};

const FORM_ANALYSIS_SHOT_TYPES = FORM_ANALYSIS_SHOT_OPTIONS.map((option) => option.value);

export function getShotTypeLabel(shotType: ShotType): string {
  return FORM_ANALYSIS_SHOT_LABELS[shotType];
}

export function normalizeFormShotTypeParam(value: string | string[] | undefined): ShotType {
  const raw = Array.isArray(value) ? value[0] : value;

  if (raw && FORM_ANALYSIS_SHOT_TYPES.includes(raw as ShotType)) {
    return raw as ShotType;
  }

  return 'forehand';
}
