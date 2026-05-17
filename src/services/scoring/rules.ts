import { type Bounce } from '@/types/ball';
import { type AutoPointCandidate } from '@/types/scoring';
import { generateId } from '@/utils/id';

export type PlayerSide = 'near' | 'far';

export interface RallyEvent {
  type: 'bounce';
  bounce: Bounce;
  /** Which half of the court this bounce landed in. */
  side: PlayerSide;
}

export interface RulesOptions {
  /** Which side of the court is the player (near=bottom, far=top). */
  playerSide: PlayerSide;
  isServe: boolean;
  serveAttempt?: 1 | 2;
}

/**
 * Applies deterministic tennis rules to a sequence of bounce events.
 * Returns an AutoPointCandidate representing the point outcome.
 * Returns null if there is insufficient data to make a determination.
 */
export function applyRules(
  bounces: Bounce[],
  endTimeSec: number,
  options: RulesOptions
): AutoPointCandidate | null {
  if (bounces.length === 0) return null;

  const { playerSide, isServe, serveAttempt = 1 } = options;
  const opponentSide: PlayerSide = playerSide === 'near' ? 'far' : 'near';
  const diagnostics: string[] = [];
  let rallyCount = 0;

  // Assign each bounce to a court side based on courtY
  // near side = courtY > 0.5, far side = courtY < 0.5
  const classified = bounces.map((b) => ({
    ...b,
    side: (b.courtPoint.y > 0.5 ? 'near' : 'far') as PlayerSide,
  }));

  // Serve handling
  if (isServe) {
    const firstBounce = classified[0];
    if (!firstBounce.inBounds) {
      if (serveAttempt === 2) {
        diagnostics.push('サーブがアウト（ダブルフォルト）');
        return {
          id: generateId(),
          suggestedOutcome: 'lost',
          suggestedShotType: 'serve',
          suggestedResultReason: 'out',
          suggestedRallyCount: 0,
          suggestedServeResult: 'doubleFault',
          videoTimestamp: firstBounce.timeSec,
          diagnostics,
        };
      }
      diagnostics.push('1st サーブアウト（フォルト）');
      return null; // Only a fault, not a point
    }
    diagnostics.push(`${serveAttempt === 1 ? '1st' : '2nd'} サーブイン`);
    rallyCount = 1;
  }

  // Count consecutive bounces on the same side (2 bounces = point lost for that side)
  let consecutiveSameSide = 0;
  let lastSide: PlayerSide | null = null;
  let winnerSide: PlayerSide | null = null;
  let pointTimeSec = endTimeSec;
  type ClassifiedBounce = Bounce & { side: PlayerSide };
  let lastOutOfBounds: ClassifiedBounce | null = null;

  for (const bounce of classified) {
    if (!bounce.inBounds) {
      lastOutOfBounds = bounce;
      // Ball went out — the side that hit it out loses
      diagnostics.push(`バウンドがコート外（${bounce.side} 側）`);
      break;
    }

    if (bounce.side === lastSide) {
      consecutiveSameSide++;
      if (consecutiveSameSide >= 2) {
        // 2nd bounce on same side — that side loses
        winnerSide = bounce.side === playerSide ? opponentSide : playerSide;
        pointTimeSec = bounce.timeSec;
        diagnostics.push(
          `${bounce.side === playerSide ? '自陣' : '相手陣'}で 2 バウンド → ${bounce.side === playerSide ? '失点' : '得点'}`
        );
        break;
      }
    } else {
      consecutiveSameSide = 1;
      lastSide = bounce.side;
    }
    rallyCount++;
  }

  // Out-of-bounds handling
  if (lastOutOfBounds && !winnerSide) {
    // Ball bounced out on opponent's side = player hit it out → player loses
    if (lastOutOfBounds.side === opponentSide) {
      winnerSide = opponentSide;
      pointTimeSec = lastOutOfBounds.timeSec;
      diagnostics.push('相手コート外にアウト');
    } else {
      winnerSide = playerSide;
      pointTimeSec = lastOutOfBounds.timeSec;
      diagnostics.push('相手がアウト → 得点');
    }
  }

  if (!winnerSide) return null; // Not enough data

  const outcome = winnerSide === playerSide ? 'won' : 'lost';
  const resultReason: AutoPointCandidate['suggestedResultReason'] = lastOutOfBounds
    ? 'out'
    : outcome === 'won'
      ? 'winner'
      : 'unforcedError';

  return {
    id: generateId(),
    suggestedOutcome: outcome,
    suggestedShotType: isServe ? 'serve' : 'forehand',
    suggestedResultReason: resultReason,
    suggestedRallyCount: Math.max(0, rallyCount - 1),
    suggestedServeResult: isServe
      ? outcome === 'won'
        ? serveAttempt === 1
          ? 'firstIn'
          : 'secondIn'
        : 'doubleFault'
      : undefined,
    videoTimestamp: pointTimeSec,
    diagnostics,
  };
}
