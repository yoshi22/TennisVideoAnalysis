import { type ServeResult } from '@/types/point';
import { colors } from '@/theme';

export interface ServeResultMeta {
  result: ServeResult;
  label: string;
  color: string;
}

export const SERVE_RESULT_META: Record<ServeResult, ServeResultMeta> = {
  firstIn: { result: 'firstIn', label: '1stイン', color: colors.success },
  secondIn: { result: 'secondIn', label: '2ndイン', color: colors.warning },
  doubleFault: { result: 'doubleFault', label: 'ダブルフォルト', color: colors.danger },
  ace: { result: 'ace', label: 'エース', color: colors.primary },
  returnError: { result: 'returnError', label: 'リターンエラー', color: colors.softAccent },
};

export const SERVE_RESULTS: ServeResult[] = [
  'firstIn',
  'secondIn',
  'doubleFault',
  'ace',
  'returnError',
];
