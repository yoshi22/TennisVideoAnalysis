import { type AutoPointCandidate } from '@/types/scoring';

import { type RallyAnalysis } from '../ball';
import { applyRules, type PlayerSide } from './rules';

export interface AutoScoreOptions {
  playerSide: PlayerSide;
  isServe?: boolean;
  serveAttempt?: 1 | 2;
}

/**
 * Produces AutoPointCandidate proposals from a rally analysis.
 * Returns an empty array when there is insufficient data.
 */
export function proposeCandidates(
  rally: RallyAnalysis,
  options: AutoScoreOptions
): AutoPointCandidate[] {
  const endTimeSec =
    rally.trajectory.detections.length > 0
      ? rally.trajectory.detections[rally.trajectory.detections.length - 1].timeSec
      : 0;

  const candidate = applyRules(rally.bounces, endTimeSec, {
    playerSide: options.playerSide,
    isServe: options.isServe ?? false,
    serveAttempt: options.serveAttempt ?? 1,
  });

  return candidate ? [candidate] : [];
}
