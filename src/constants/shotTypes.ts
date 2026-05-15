import { type ShotType } from '@/types/point';
import { colors } from '@/theme';

export interface ShotTypeMeta {
  type: ShotType;
  label: string;
  shortLabel: string;
  color: string;
}

export const SHOT_TYPE_META: Record<ShotType, ShotTypeMeta> = {
  serve: { type: 'serve', label: 'サーブ', shortLabel: 'Sv', color: colors.primary },
  forehand: { type: 'forehand', label: 'フォアハンド', shortLabel: 'FH', color: colors.courtBlue },
  backhand: {
    type: 'backhand',
    label: 'バックハンド',
    shortLabel: 'BH',
    color: colors.courtPurple,
  },
  volley: { type: 'volley', label: 'ボレー', shortLabel: 'Vo', color: colors.courtCyan },
  smash: { type: 'smash', label: 'スマッシュ', shortLabel: 'Sm', color: colors.danger },
  lob: { type: 'lob', label: 'ロブ', shortLabel: 'Lb', color: colors.warning },
  drop: { type: 'drop', label: 'ドロップ', shortLabel: 'Dr', color: colors.success },
};

export const SHOT_TYPES: ShotType[] = [
  'serve',
  'forehand',
  'backhand',
  'volley',
  'smash',
  'lob',
  'drop',
];
