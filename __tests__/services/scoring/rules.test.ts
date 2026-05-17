import { applyRules } from '@/services/scoring/rules';
import { type Bounce } from '@/types/ball';

function makeBounce(courtX: number, courtY: number, timeSec: number, inBounds = true): Bounce {
  return {
    timeSec,
    imagePoint: { x: 0.5, y: 0.5 },
    courtPoint: { x: courtX, y: courtY },
    inBounds,
  };
}

const PLAYER_SIDE = 'near'; // player is at bottom (courtY > 0.5)

describe('applyRules', () => {
  it('returns null with no bounces', () => {
    expect(applyRules([], 5, { playerSide: PLAYER_SIDE, isServe: false })).toBeNull();
  });

  it('2 bounces on player side → lost', () => {
    const bounces = [
      makeBounce(0.5, 0.8, 1.0), // near (player side)
      makeBounce(0.5, 0.2, 1.5), // far (opponent)
      makeBounce(0.5, 0.75, 2.0), // near again (player side)
      makeBounce(0.5, 0.8, 2.5), // near — 2nd consecutive → lost
    ];
    const result = applyRules(bounces, 3.0, { playerSide: PLAYER_SIDE, isServe: false });
    expect(result?.suggestedOutcome).toBe('lost');
  });

  it('2 bounces on opponent side → won', () => {
    const bounces = [
      makeBounce(0.5, 0.8, 1.0), // near
      makeBounce(0.5, 0.2, 1.5), // far
      makeBounce(0.5, 0.15, 2.0), // far — 2nd consecutive → won
    ];
    const result = applyRules(bounces, 3.0, { playerSide: PLAYER_SIDE, isServe: false });
    expect(result?.suggestedOutcome).toBe('won');
  });

  it('opponent ball bounces out on player side → won', () => {
    // Opponent hit the ball; it landed out-of-bounds on player's side → player wins
    const bounces = [
      makeBounce(0.5, 0.2, 1.0), // far side (player's return landed on opponent's side)
      makeBounce(0.5, 0.85, 1.5, false), // near side, out → opponent hit out
    ];
    const result = applyRules(bounces, 2.0, { playerSide: PLAYER_SIDE, isServe: false });
    expect(result?.suggestedOutcome).toBe('won');
  });

  it('player ball bounces out on opponent side → lost', () => {
    // Player hit the ball; it landed out-of-bounds on opponent's side → player loses
    const bounces = [
      makeBounce(0.5, 0.8, 1.0), // near side (opponent's shot landed)
      makeBounce(1.5, 0.2, 1.5, false), // far side, out → player hit out
    ];
    const result = applyRules(bounces, 2.0, { playerSide: PLAYER_SIDE, isServe: false });
    expect(result?.suggestedOutcome).toBe('lost');
  });

  it('double fault — 2nd serve out → lost', () => {
    const bounces = [makeBounce(1.5, 0.2, 0.5, false)]; // out
    const result = applyRules(bounces, 1.0, {
      playerSide: PLAYER_SIDE,
      isServe: true,
      serveAttempt: 2,
    });
    expect(result?.suggestedOutcome).toBe('lost');
    expect(result?.suggestedServeResult).toBe('doubleFault');
  });

  it('1st serve fault → returns null (not a point)', () => {
    const bounces = [makeBounce(1.5, 0.2, 0.5, false)];
    const result = applyRules(bounces, 1.0, {
      playerSide: PLAYER_SIDE,
      isServe: true,
      serveAttempt: 1,
    });
    expect(result).toBeNull();
  });
});
