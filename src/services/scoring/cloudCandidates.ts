import {
  type CloudAnalyzeResult,
  type CloudContact,
  type CloudStrokeContact,
} from '@/services/analysis/cloudAnalyze';
import { type AutoPointCandidate, type ShotType } from '@/types';
import { generateId } from '@/utils/id';

/**
 * Map a cloud shot-events result into per-rally AutoPointCandidate[] so the
 * existing auto-score review UI (AutoPointCard → buildDraftPointFromCandidate)
 * can turn them into draft PointRecords — the correction flywheel.
 *
 * One candidate per rally (matching the manual point model). Per-shot detail
 * (speed / course / FH-BH) is surfaced in `diagnostics` for now; a dedicated
 * per-shot coaching report is a separate UI concern.
 *
 * Outcome / resultReason cannot be inferred from ball tracking, so they default
 * to placeholders the user corrects during review (outcome toggle already exists).
 */

function strokeKey(rally: number, frameIdx: number): string {
  return `${rally}:${frameIdx}`;
}

function dominantShotType(strokes: CloudStrokeContact[]): {
  shotType: ShotType;
  fh: number;
  bh: number;
} {
  let fh = 0;
  let bh = 0;
  for (const s of strokes) {
    if (s.stroke === 'forehand') fh += 1;
    else if (s.stroke === 'backhand') bh += 1;
  }
  // Unknown-heavy rallies fall back to forehand (most common); user can edit.
  const shotType: ShotType = bh > fh ? 'backhand' : 'forehand';
  return { shotType, fh, bh };
}

function round(value: number | null | undefined, digits = 0): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export interface CloudCandidateOptions {
  /** Injectable for deterministic tests. */
  idFactory?: () => string;
}

export function cloudResultToCandidates(
  result: CloudAnalyzeResult,
  options: CloudCandidateOptions = {}
): AutoPointCandidate[] {
  const events = result.events;
  if (!events || !Array.isArray(events.rallies)) return [];

  const idFactory = options.idFactory ?? generateId;

  const strokeByContact = new Map<string, CloudStrokeContact>();
  for (const s of result.strokes?.contacts ?? []) {
    strokeByContact.set(strokeKey(s.rally, s.frameIdx), s);
  }

  const candidates: AutoPointCandidate[] = [];
  for (const rally of events.rallies) {
    const contacts: CloudContact[] = Array.isArray(rally.contacts) ? rally.contacts : [];
    if (contacts.length === 0) continue;

    const rallyStrokes = contacts
      .map((c) => strokeByContact.get(strokeKey(c.rally, c.frameIdx)))
      .filter((s): s is CloudStrokeContact => Boolean(s));
    const { shotType, fh, bh } = dominantShotType(rallyStrokes);

    const startSec = contacts[0].timeSec;
    const endSec = contacts[contacts.length - 1].timeSec;
    const p95 = round(rally.p95_kmh, 0);
    const median = round(rally.median_kmh, 0);
    const lastZone = contacts[contacts.length - 1].zone?.label;

    const diagnostics: string[] = [
      `${contacts.length}打を検出(rally ${rally.rally})`,
      p95 !== null || median !== null
        ? `速度(目安) p95 ${p95 ?? '-'}km/h / 中央値 ${median ?? '-'}km/h`
        : '速度データなし',
      `FH ${fh} / BH ${bh}${rallyStrokes.length < contacts.length ? ` / 不明 ${contacts.length - rallyStrokes.length}` : ''}`,
      lastZone ? `最終着地ゾーン ${lastZone}` : '着地ゾーン不明',
      '⚠ 勝敗・結果理由は自動判定不可。レビューで修正してください',
    ];

    candidates.push({
      id: idFactory(),
      // Outcome/reason are placeholders — user corrects them in review.
      suggestedOutcome: 'won',
      suggestedShotType: shotType,
      suggestedResultReason: 'winner',
      suggestedRallyCount: contacts.length,
      videoTimestamp: endSec,
      rallyStartSec: startSec,
      rallyEndSec: endSec,
      diagnostics,
    });
  }

  return candidates;
}
