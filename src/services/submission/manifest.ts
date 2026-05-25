import Constants from 'expo-constants';

import { CONSENT_VERSION } from '@/stores/betaStore';
import { type SubmissionManifest, type SubmissionPointLabel, type SubmissionRally } from '@/types';
import { type TennisSession } from '@/types/session';
import { generateId } from '@/utils/id';
import { getConfirmedPoints, isConfirmed } from '@/utils/pointDetails';

interface BetaConsentState {
  participantId: string;
  consentVersion?: number;
  consentAcceptedAt?: string;
}

function isValidRallyInterval(
  point: TennisSession['points'][number]
): point is TennisSession['points'][number] & { rallyStartSec: number; rallyEndSec: number } {
  return (
    Number.isFinite(point.rallyStartSec) &&
    Number.isFinite(point.rallyEndSec) &&
    point.rallyStartSec !== undefined &&
    point.rallyEndSec !== undefined &&
    point.rallyStartSec >= 0 &&
    point.rallyEndSec > point.rallyStartSec
  );
}

function toSubmissionRallies(session: TennisSession): SubmissionRally[] {
  return session.points
    .filter(isConfirmed)
    .filter(isValidRallyInterval)
    .sort((a, b) => a.rallyStartSec - b.rallyStartSec)
    .map((p) => ({
      startSec: Math.round(p.rallyStartSec * 10) / 10,
      endSec: Math.round(p.rallyEndSec * 10) / 10,
    }));
}

function toSubmissionPoints(session: TennisSession): SubmissionPointLabel[] {
  return getConfirmedPoints(session.points).map((p) => ({
    videoTimestamp: p.videoTimestamp,
    rallyStartSec: p.rallyStartSec,
    rallyEndSec: p.rallyEndSec,
    outcome: p.outcome,
    shotType: p.shotType,
    serveResult: p.serveResult,
    resultReason: p.resultReason,
    rallyCount: p.rallyCount,
    shotLocation: p.shotLocation,
    targetLocation: p.targetLocation,
  }));
}

function hasEnoughLabels(session: TennisSession, rallies: SubmissionRally[]): boolean {
  if (session.sessionType === 'serveTraining') {
    return getConfirmedPoints(session.points).length >= 1;
  }
  return rallies.length >= 1;
}

/**
 * Builds a submission manifest for a session.
 * Returns null when prerequisites aren't met:
 * - no videoUri
 * - consent not given (version mismatch or missing acceptedAt)
 * - insufficient labels for the session type
 */
export function buildSubmissionManifest(
  session: TennisSession,
  beta: BetaConsentState
): SubmissionManifest | null {
  if (!session.videoUri) return null;
  if (
    beta.consentVersion !== CONSENT_VERSION ||
    typeof beta.consentAcceptedAt !== 'string' ||
    Number.isNaN(new Date(beta.consentAcceptedAt).getTime())
  ) {
    return null;
  }

  const rallies = toSubmissionRallies(session);
  if (!hasEnoughLabels(session, rallies)) return null;

  const filename = session.videoUri.split('/').pop() ?? 'video.mp4';
  const appVersion = Constants.expoConfig?.version ?? 'unknown';

  return {
    schemaVersion: 1,
    submissionId: generateId(),
    participantId: beta.participantId,
    appVersion,
    createdAt: new Date().toISOString(),
    sport: session.sport,
    sessionType: session.sessionType,
    matchFormat: session.matchFormat,
    position: session.sport === 'softTennis' ? session.position : undefined,
    video: {
      filename,
      durationSec: session.videoDurationSec,
      fps: 30,
      sha256: '',
    },
    courtCalibration: session.courtCalibration,
    rallies,
    points: toSubmissionPoints(session),
    consent: {
      version: beta.consentVersion,
      acceptedAt: beta.consentAcceptedAt,
    },
  };
}
