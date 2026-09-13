import { type CloudAnalyzeResult, type CloudStrokeContact } from '@/services/analysis/cloudAnalyze';
import {
  type RallyAnalysis,
  type RallyBounceRecord,
  type RallyOutcome,
  type RallyRecord,
  type ShotLocation,
  type ShotRecord,
  type StrokeKind,
} from '@/types';
import { generateId } from '@/utils/id';

const COURT_LENGTH_M = 23.77;
const SINGLES_WIDTH_M = 8.23;
const DOUBLES_WIDTH_M = 10.97;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function widthM(courtType: 'singles' | 'doubles'): number {
  return courtType === 'doubles' ? DOUBLES_WIDTH_M : SINGLES_WIDTH_M;
}

function toLocation(
  courtXY: [number, number] | undefined,
  courtWidthM: number
): ShotLocation | undefined {
  if (!courtXY) return undefined;
  return { x: clamp01(courtXY[0] / courtWidthM), y: clamp01(courtXY[1] / COURT_LENGTH_M) };
}

function strokeKey(rally: number, frameIdx: number): string {
  return `${rally}:${frameIdx}`;
}

/**
 * Heuristic point outcome for the tracked player from the last bounce.
 * Intentionally low-confidence — the user confirms in the rally-history UI.
 */
export function inferRallyOutcome(
  bounces: RallyBounceRecord[],
  playerSide: 'near' | 'far'
): { outcome: RallyOutcome; confidence: number } {
  if (bounces.length === 0) return { outcome: 'unknown', confidence: 0 };
  const last = bounces[bounces.length - 1];
  const netY = COURT_LENGTH_M / 2;
  const half: 'near' | 'far' = last.courtXY[1] < netY ? 'near' : 'far';
  const opponentSide = playerSide === 'near' ? 'far' : 'near';

  if (last.inBounds && half === opponentSide) return { outcome: 'won', confidence: 0.45 };
  if (last.inBounds && half === playerSide) return { outcome: 'lost', confidence: 0.4 };
  return { outcome: 'unknown', confidence: 0.2 };
}

export interface RallyAnalysisOptions {
  playerSide?: 'near' | 'far';
  source?: 'cloud' | 'on-device';
  idFactory?: () => string;
  now?: string;
}

export function cloudResultToRallyAnalysis(
  result: CloudAnalyzeResult,
  options: RallyAnalysisOptions = {}
): RallyAnalysis {
  const playerSide = options.playerSide ?? 'near';
  const idFactory = options.idFactory ?? generateId;
  const createdAt = options.now ?? new Date().toISOString();
  const courtType: 'singles' | 'doubles' = result.court_type === 'doubles' ? 'doubles' : 'singles';
  const wM = widthM(courtType);

  const strokeByContact = new Map<string, CloudStrokeContact>();
  for (const s of result.strokes?.contacts ?? []) {
    strokeByContact.set(strokeKey(s.rally, s.frameIdx), s);
  }

  const rallies: RallyRecord[] = [];
  let totalShots = 0;
  let totalBounces = 0;

  for (const rally of result.events?.rallies ?? []) {
    const contacts = Array.isArray(rally.contacts) ? rally.contacts : [];
    if (contacts.length === 0) continue;

    const shots: ShotRecord[] = contacts.map((c, i) => {
      const joined = strokeByContact.get(strokeKey(c.rally, c.frameIdx))?.stroke;
      const stroke: StrokeKind = joined ?? (i === 0 ? 'serve' : 'unknown');
      return {
        index: i + 1,
        stroke,
        timeSec: c.timeSec,
        frameIdx: c.frameIdx,
        courtXY: c.court_xy_m,
        location: toLocation(c.court_xy_m, wM),
        zoneLabel: c.zone?.label,
        speedKmh: c.speed_kmh ?? null,
      };
    });

    const bounces: RallyBounceRecord[] = (Array.isArray(rally.bounces) ? rally.bounces : [])
      .filter((b) => Array.isArray(b.court_xy_m))
      .map((b) => ({
        timeSec: b.timeSec,
        courtXY: b.court_xy_m as [number, number],
        location: toLocation(b.court_xy_m, wM),
        zoneLabel: b.zone?.label,
        inBounds: b.zone?.in_bounds,
      }));

    const { outcome, confidence } = inferRallyOutcome(bounces, playerSide);
    totalShots += shots.length;
    totalBounces += bounces.length;

    rallies.push({
      rally: rally.rally,
      startSec: contacts[0].timeSec,
      endSec: contacts[contacts.length - 1].timeSec,
      shotCount: shots.length,
      shots,
      bounces,
      p95Kmh: rally.p95_kmh ?? null,
      medianKmh: rally.median_kmh ?? null,
      outcome,
      outcomeConfidence: confidence,
      outcomeSource: 'auto',
    });
  }

  const summary = result.summary ?? {};
  return {
    id: idFactory(),
    createdAt,
    source: options.source ?? 'cloud',
    courtType,
    playerSide,
    summary: {
      rallies: rallies.length,
      shots: totalShots,
      bounces: totalBounces,
      p95Kmh: (summary.p95SpeedKmh as number | undefined) ?? null,
      medianKmh: (summary.medianSpeedKmh as number | undefined) ?? null,
    },
    rallies,
  };
}
