import { applyPoint, computeMatchScore, initMatchScore } from '@/services/scoring/matchState';
import { HARD_TENNIS_CONFIG, SOFT_TENNIS_CONFIG } from '@/types/matchScore';
import { type PointRecord } from '@/types/point';

function makePoint(outcome: 'won' | 'lost'): PointRecord {
  return {
    id: Math.random().toString(),
    sessionId: 'test',
    timestamp: new Date().toISOString(),
    outcome,
    shotType: 'forehand',
    resultReason: 'winner',
    rallyCount: 1,
  };
}

function playPoints(outcomes: ('won' | 'lost')[], sport: 'tennis' | 'softTennis' = 'tennis') {
  return computeMatchScore(outcomes.map(makePoint), sport);
}

// ─── Hard Tennis — game scoring ───────────────────────────────────────────────

describe('Hard Tennis — game scoring', () => {
  it('4 wins → 1 game won (0-15-30-40-game)', () => {
    const state = playPoints(['won', 'won', 'won', 'won']);
    expect(state.sets[0].gamesPlayer).toBe(1);
    expect(state.sets[0].gamesOpponent).toBe(0);
    expect(state.currentGame.player).toBe('0');
  });

  it('30-30 after 2 each', () => {
    let state = initMatchScore(HARD_TENNIS_CONFIG);
    state = applyPoint(state, 'won');
    state = applyPoint(state, 'won');
    state = applyPoint(state, 'lost');
    state = applyPoint(state, 'lost');
    expect(state.currentGame.player).toBe('30');
    expect(state.currentGame.opponent).toBe('30');
  });

  it('deuce and AD: player wins AD → wins game', () => {
    let state = initMatchScore(HARD_TENNIS_CONFIG);
    // 40-40
    for (const o of ['won', 'won', 'won', 'lost', 'lost', 'lost'] as const) {
      state = applyPoint(state, o);
    }
    expect(state.currentGame.player).toBe('40');
    expect(state.currentGame.opponent).toBe('40');
    state = applyPoint(state, 'won');
    expect(state.currentGame.player).toBe('AD');
    state = applyPoint(state, 'won');
    expect(state.sets[0].gamesPlayer).toBe(1);
    expect(state.currentGame.player).toBe('0');
  });

  it('opponent wins AD → back to deuce', () => {
    let state = initMatchScore(HARD_TENNIS_CONFIG);
    for (const o of ['won', 'won', 'won', 'lost', 'lost', 'lost'] as const) {
      state = applyPoint(state, o);
    }
    state = applyPoint(state, 'lost'); // opponent AD
    expect(state.currentGame.opponent).toBe('AD');
    state = applyPoint(state, 'won'); // back to deuce
    expect(state.currentGame.player).toBe('40');
    expect(state.currentGame.opponent).toBe('40');
  });

  it('set won at 6-0', () => {
    const outcomes: ('won' | 'lost')[] = Array(6 * 4).fill('won');
    const state = playPoints(outcomes);
    expect(state.sets[0].gamesPlayer).toBe(6);
    expect(state.sets[0].completed).toBe(true);
    expect(state.sets[0].winner).toBe('player');
    expect(state.currentSetIndex).toBe(1);
  });

  it('set requires 7-5: at 5-5, player wins 2 straight games', () => {
    // Build score to 5-5 alternating, then player wins 2 more
    const outcomes: ('won' | 'lost')[] = [];
    for (let i = 0; i < 5; i++) {
      outcomes.push(...(Array(4).fill('won') as ('won' | 'lost')[]));
      outcomes.push(...(Array(4).fill('lost') as ('won' | 'lost')[]));
    }
    // 5-5. Player wins → 6-5
    outcomes.push(...(Array(4).fill('won') as ('won' | 'lost')[]));
    // 6-5. Player wins → 7-5 set
    outcomes.push(...(Array(4).fill('won') as ('won' | 'lost')[]));
    const state = playPoints(outcomes);
    expect(state.sets[0].gamesPlayer).toBe(7);
    expect(state.sets[0].gamesOpponent).toBe(5);
    expect(state.sets[0].completed).toBe(true);
    expect(state.sets[0].winner).toBe('player');
  });

  it('tiebreak triggers at 6-6', () => {
    const outcomes: ('won' | 'lost')[] = [];
    for (let i = 0; i < 6; i++) {
      outcomes.push(...(Array(4).fill('won') as ('won' | 'lost')[]));
      outcomes.push(...(Array(4).fill('lost') as ('won' | 'lost')[]));
    }
    let state = playPoints(outcomes);
    expect(state.sets[0].gamesPlayer).toBe(6);
    expect(state.sets[0].gamesOpponent).toBe(6);
    state = applyPoint(state, 'won');
    expect(state.currentGame.isTiebreak).toBe(true);
  });

  it('tiebreak: first to 7 with 2-point lead', () => {
    const outcomes: ('won' | 'lost')[] = [];
    for (let i = 0; i < 6; i++) {
      outcomes.push(...(Array(4).fill('won') as ('won' | 'lost')[]));
      outcomes.push(...(Array(4).fill('lost') as ('won' | 'lost')[]));
    }
    let state = playPoints(outcomes);
    for (let i = 0; i < 7; i++) {
      state = applyPoint(state, 'won');
    }
    expect(state.sets[0].gamesPlayer).toBe(7);
    expect(state.sets[0].gamesOpponent).toBe(6);
    expect(state.sets[0].completed).toBe(true);
  });

  it('tiebreak requires 2-point lead: 6-6 in tiebreak, player wins 2 more', () => {
    const outcomes: ('won' | 'lost')[] = [];
    for (let i = 0; i < 6; i++) {
      outcomes.push(...(Array(4).fill('won') as ('won' | 'lost')[]));
      outcomes.push(...(Array(4).fill('lost') as ('won' | 'lost')[]));
    }
    let state = playPoints(outcomes);
    // 6-6 tb
    for (let i = 0; i < 6; i++) state = applyPoint(state, 'won');
    for (let i = 0; i < 6; i++) state = applyPoint(state, 'lost');
    expect(state.currentGame.player).toBe(6);
    expect(state.currentGame.opponent).toBe(6);
    state = applyPoint(state, 'won');
    state = applyPoint(state, 'won');
    expect(state.sets[0].gamesPlayer).toBe(7);
    expect(state.sets[0].completed).toBe(true);
  });

  it('match won at 2 sets (best of 3)', () => {
    // Win 2 sets: each set 6-0
    const outcomes: ('won' | 'lost')[] = [...Array(24).fill('won'), ...Array(24).fill('won')];
    const state = playPoints(outcomes);
    expect(state.matchWinner).toBe('player');
  });

  it('no further scoring after match winner is set', () => {
    let state = playPoints([...Array(24).fill('won'), ...Array(24).fill('won')] as (
      | 'won'
      | 'lost'
    )[]);
    expect(state.matchWinner).toBe('player');
    state = applyPoint(state, 'lost');
    expect(state.matchWinner).toBe('player');
  });
});

// ─── Soft Tennis ──────────────────────────────────────────────────────────────

describe('Soft Tennis — game scoring', () => {
  it('4 points → game won (numeric scores)', () => {
    const state = playPoints(['won', 'won', 'won', 'won'], 'softTennis');
    expect(state.sets[0].gamesPlayer).toBe(1);
    expect(state.sets[0].gamesOpponent).toBe(0);
    expect(state.currentGame.player).toBe(0);
  });

  it('point scores increment as numbers 0→1→2→3', () => {
    let state = initMatchScore(SOFT_TENNIS_CONFIG);
    state = applyPoint(state, 'won');
    expect(state.currentGame.player).toBe(1);
    state = applyPoint(state, 'won');
    expect(state.currentGame.player).toBe(2);
    state = applyPoint(state, 'won');
    expect(state.currentGame.player).toBe(3);
  });

  it('deuce at 3-3, player wins 2 straight → game won', () => {
    let state = initMatchScore(SOFT_TENNIS_CONFIG);
    // Reach 3-3
    for (const o of ['won', 'won', 'won', 'lost', 'lost', 'lost'] as const) {
      state = applyPoint(state, o);
    }
    expect(state.currentGame.player).toBe(3);
    expect(state.currentGame.opponent).toBe(3);
    state = applyPoint(state, 'won'); // 4-3
    expect(state.currentGame.player).toBe(4);
    state = applyPoint(state, 'won'); // 5-3 → game won
    expect(state.sets[0].gamesPlayer).toBe(1);
    expect(state.currentGame.player).toBe(0);
  });

  it('deuce: opponent recovers to 4-4 (back to deuce)', () => {
    let state = initMatchScore(SOFT_TENNIS_CONFIG);
    for (const o of ['won', 'won', 'won', 'lost', 'lost', 'lost'] as const) {
      state = applyPoint(state, o);
    }
    state = applyPoint(state, 'won'); // 4-3
    state = applyPoint(state, 'lost'); // 4-4 — back at deuce
    expect(state.currentGame.player).toBe(4);
    expect(state.currentGame.opponent).toBe(4);
    expect(state.sets[0].gamesPlayer).toBe(0);
  });

  it('match won at 3 sets', () => {
    // Soft tennis: win 3 sets of 4 games each (4-0 each set)
    const outcomes: ('won' | 'lost')[] = [
      ...Array(4 * 4).fill('won'),
      ...Array(4 * 4).fill('won'),
      ...Array(4 * 4).fill('won'),
    ];
    const state = playPoints(outcomes, 'softTennis');
    expect(state.matchWinner).toBe('player');
  });

  it('opponent wins soft tennis match', () => {
    const outcomes: ('won' | 'lost')[] = [
      ...Array(4 * 4).fill('lost'),
      ...Array(4 * 4).fill('lost'),
      ...Array(4 * 4).fill('lost'),
    ];
    const state = playPoints(outcomes, 'softTennis');
    expect(state.matchWinner).toBe('opponent');
  });
});

// ─── computeMatchScore ────────────────────────────────────────────────────────

describe('computeMatchScore', () => {
  it('empty points → initial state', () => {
    const state = computeMatchScore([], 'tennis');
    expect(state.sets[0].gamesPlayer).toBe(0);
    expect(state.matchWinner).toBeUndefined();
    expect(state.currentGame.player).toBe('0');
  });

  it('empty soft tennis → numeric initial game', () => {
    const state = computeMatchScore([], 'softTennis');
    expect(state.currentGame.player).toBe(0);
  });
});
