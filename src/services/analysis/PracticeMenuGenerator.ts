import { coachingRules } from '@/data/coachingRules';
import { type PracticeDrill, type WeaknessPattern } from '@/types';

export function generatePracticeMenu(weaknesses: WeaknessPattern[]): PracticeDrill[] {
  return weaknesses
    .flatMap((weakness) => coachingRules[weakness].drills)
    .sort((a, b) => a.durationMin - b.durationMin);
}
