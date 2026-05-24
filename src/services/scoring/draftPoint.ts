import { type AutoPointCandidate, type PointRecord } from '@/types';
import { generateId } from '@/utils/id';

export function buildDraftPointFromCandidate(
  sessionId: string,
  candidate: AutoPointCandidate,
  id = generateId(),
  timestamp = new Date().toISOString()
): PointRecord {
  return {
    id,
    sessionId,
    timestamp,
    outcome: candidate.suggestedOutcome,
    serveResult: candidate.suggestedServeResult,
    shotType: candidate.suggestedShotType,
    resultReason: candidate.suggestedResultReason,
    rallyCount: candidate.suggestedRallyCount,
    detailStatus: 'complete',
    shotLocation: candidate.suggestedShotLocation,
    videoTimestamp: candidate.videoTimestamp,
    source: 'auto',
    reviewStatus: 'draft',
    confidence: candidate.confidence,
    rallyStartSec: candidate.rallyStartSec,
    rallyEndSec: candidate.rallyEndSec,
  };
}
