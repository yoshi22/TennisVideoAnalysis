import { coachingRules } from '@/data/coachingRules';
import { type CoachingTip, type WeaknessPattern } from '@/types';

const priorityRank: Record<CoachingTip['priority'], number> = {
  high: 0,
  medium: 1,
  low: 2,
};

export function generateCoachingTips(weaknesses: WeaknessPattern[]): CoachingTip[] {
  return weaknesses
    .flatMap((weakness) => coachingRules[weakness].tips)
    .sort((a, b) => priorityRank[a.priority] - priorityRank[b.priority]);
}
