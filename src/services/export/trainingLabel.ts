import { type TennisSession } from '@/types/session';

const DEFAULT_EXPORT_FPS = 30;

export interface TrainingRally {
  startSec: number;
  endSec: number;
  server: null;
  winner: null;
  endReason: null;
}

export interface TrainingLabel {
  schemaVersion: 1;
  videoId: string;
  sourceUrl: string;
  sourceSha256: string;
  fps: number;
  clipOffsetSec: number;
  clipDurationSec: number;
  note: string;
  rallies: TrainingRally[];
}

function roundSec(value: number): number {
  return Math.round(value * 10) / 10;
}

function isValidRallyInterval(
  point: TennisSession['points'][number]
): point is TennisSession['points'][number] & { rallyStartSec: number; rallyEndSec: number } {
  return (
    Number.isFinite(point.rallyStartSec) &&
    Number.isFinite(point.rallyEndSec) &&
    point.rallyStartSec !== undefined &&
    point.rallyEndSec !== undefined &&
    point.rallyEndSec > point.rallyStartSec
  );
}

/**
 * Builds a training-format label JSON from a session's points.
 * Only includes points that have both rallyStartSec and rallyEndSec.
 * The output schema matches the rally-interval format used by the eval pipeline.
 */
export function buildTrainingLabel(session: TennisSession): TrainingLabel | null {
  if (!session.videoUri) return null;

  const rallies: TrainingRally[] = session.points
    .filter(isValidRallyInterval)
    .sort((a, b) => a.rallyStartSec - b.rallyStartSec)
    .map((p) => ({
      startSec: roundSec(p.rallyStartSec),
      endSec: roundSec(p.rallyEndSec),
      server: null,
      winner: null,
      endReason: null,
    }));

  if (rallies.length === 0) return null;

  const inferredDurationSec = Math.max(...rallies.map((rally) => rally.endSec));
  const clipDurationSec =
    session.videoDurationSec && session.videoDurationSec > 0
      ? roundSec(session.videoDurationSec)
      : inferredDurationSec;
  const videoId = `user-${session.id}`;

  return {
    schemaVersion: 1,
    videoId,
    sourceUrl: session.videoUri,
    sourceSha256: '',
    fps: DEFAULT_EXPORT_FPS,
    clipOffsetSec: 0,
    clipDurationSec,
    note: `User-exported rally interval labels from session "${session.title}" recorded at ${session.startedAt}.`,
    rallies,
  };
}

export function buildTrainingLabelJson(session: TennisSession): string | null {
  const label = buildTrainingLabel(session);
  if (!label) return null;
  return JSON.stringify(label, null, 2);
}
