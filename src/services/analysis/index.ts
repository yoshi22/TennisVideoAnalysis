import { ManualAnalyzer } from './ManualAnalyzer';
import { type TennisAnalyzer } from './TennisAnalyzer';

let _analyzer: TennisAnalyzer | null = null;

export function getAnalyzer(): TennisAnalyzer {
  if (_analyzer === null) {
    _analyzer = new ManualAnalyzer();
  }

  return _analyzer;
}

export type { TennisAnalyzer };
export { generateCoachingTips } from './CoachingTipsGenerator';
export { generatePracticeMenu } from './PracticeMenuGenerator';
