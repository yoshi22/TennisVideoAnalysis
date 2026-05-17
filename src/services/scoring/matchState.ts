import { type PointOutcome, type PointRecord } from '@/types/point';
import {
  HARD_TENNIS_CONFIG,
  SOFT_TENNIS_CONFIG,
  type GameScore,
  type MatchScore,
  type MatchScoreConfig,
  type SetScore,
  type TennisPointScore,
} from '@/types/matchScore';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const HARD_SEQUENCE: TennisPointScore[] = ['0', '15', '30', '40'];

function makeHardGame(): GameScore {
  return { player: '0', opponent: '0', isTiebreak: false };
}

function makeSoftGame(): GameScore {
  return { player: 0, opponent: 0, isTiebreak: false };
}

function makeTiebreakGame(): GameScore {
  return { player: 0, opponent: 0, isTiebreak: true };
}

function makeInitialSet(): SetScore {
  return { gamesPlayer: 0, gamesOpponent: 0, completed: false };
}

function makeEmptyGame(config: MatchScoreConfig): GameScore {
  return config.sport === 'soft' ? makeSoftGame() : makeHardGame();
}

// ─── Game point logic ─────────────────────────────────────────────────────────

function applyHardPoint(
  game: GameScore,
  winner: 'player' | 'opponent'
): { game: GameScore; won: boolean } {
  const p = game.player as TennisPointScore;
  const o = game.opponent as TennisPointScore;
  const atDeuce = p === '40' && o === '40';
  const playerAd = p === 'AD';
  const opponentAd = o === 'AD';

  if (winner === 'player') {
    if (playerAd) return { game: makeHardGame(), won: true };
    if (opponentAd) return { game: { ...game, player: '40', opponent: '40' }, won: false };
    if (atDeuce) return { game: { ...game, player: 'AD' }, won: false };
    const idx = HARD_SEQUENCE.indexOf(p);
    if (idx === 3) return { game: makeHardGame(), won: true }; // 40 → game
    return { game: { ...game, player: HARD_SEQUENCE[idx + 1] }, won: false };
  } else {
    if (opponentAd) return { game: makeHardGame(), won: true };
    if (playerAd) return { game: { ...game, player: '40', opponent: '40' }, won: false };
    if (atDeuce) return { game: { ...game, opponent: 'AD' }, won: false };
    const idx = HARD_SEQUENCE.indexOf(o);
    if (idx === 3) return { game: makeHardGame(), won: true };
    return { game: { ...game, opponent: HARD_SEQUENCE[idx + 1] }, won: false };
  }
}

function applySoftPoint(
  game: GameScore,
  winner: 'player' | 'opponent'
): { game: GameScore; won: boolean } {
  const p = game.player as number;
  const o = game.opponent as number;
  const isDeuce = p >= 3 && o >= 3;

  if (winner === 'player') {
    const next = p + 1;
    if (isDeuce) {
      if (next - o >= 2) return { game: makeSoftGame(), won: true };
      return { game: { ...game, player: next }, won: false };
    }
    if (next >= 4) return { game: makeSoftGame(), won: true };
    return { game: { ...game, player: next }, won: false };
  } else {
    const next = o + 1;
    if (isDeuce) {
      if (next - p >= 2) return { game: makeSoftGame(), won: true };
      return { game: { ...game, opponent: next }, won: false };
    }
    if (next >= 4) return { game: makeSoftGame(), won: true };
    return { game: { ...game, opponent: next }, won: false };
  }
}

function applyTiebreakPoint(
  game: GameScore,
  winner: 'player' | 'opponent'
): { game: GameScore; won: boolean } {
  const p = game.player as number;
  const o = game.opponent as number;

  if (winner === 'player') {
    const next = p + 1;
    if (next >= 7 && next - o >= 2) return { game: makeTiebreakGame(), won: true };
    return { game: { ...game, player: next }, won: false };
  } else {
    const next = o + 1;
    if (next >= 7 && next - p >= 2) return { game: makeTiebreakGame(), won: true };
    return { game: { ...game, opponent: next }, won: false };
  }
}

// ─── Set / match logic ────────────────────────────────────────────────────────

function isSetOver(gamesPlayer: number, gamesOpponent: number, config: MatchScoreConfig): boolean {
  const needed = config.gamesPerSet;
  const tb = config.tiebreakAt;

  if (tb !== undefined) {
    if (gamesPlayer === tb + 1 && gamesOpponent === tb) return true;
    if (gamesOpponent === tb + 1 && gamesPlayer === tb) return true;
  }
  if (gamesPlayer >= needed && gamesPlayer - gamesOpponent >= 2) return true;
  if (gamesOpponent >= needed && gamesOpponent - gamesPlayer >= 2) return true;
  return false;
}

function isTiebreakActive(set: SetScore, config: MatchScoreConfig): boolean {
  return (
    config.tiebreakAt !== undefined &&
    set.gamesPlayer === config.tiebreakAt &&
    set.gamesOpponent === config.tiebreakAt
  );
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function initMatchScore(config: MatchScoreConfig): MatchScore {
  return {
    currentGame: makeEmptyGame(config),
    sets: [makeInitialSet()],
    currentSetIndex: 0,
    config,
  };
}

export function applyPoint(state: MatchScore, outcome: PointOutcome): MatchScore {
  if (state.matchWinner !== undefined) return state;

  const winner: 'player' | 'opponent' = outcome === 'won' ? 'player' : 'opponent';
  const config = state.config;
  const sets = [...state.sets];
  const setIdx = state.currentSetIndex;
  const currentSet = { ...sets[setIdx] };

  // Determine whether we're in a tiebreak
  const tiebreakNeeded = isTiebreakActive(currentSet, config);
  let currentGame = { ...state.currentGame };
  if (tiebreakNeeded && !currentGame.isTiebreak) {
    currentGame = makeTiebreakGame();
  }

  // Apply point to the game
  let gameWon: boolean;
  let nextGame: GameScore;

  if (currentGame.isTiebreak) {
    const result = applyTiebreakPoint(currentGame, winner);
    nextGame = result.game;
    gameWon = result.won;
  } else if (config.sport === 'soft') {
    const result = applySoftPoint(currentGame, winner);
    nextGame = result.game;
    gameWon = result.won;
  } else {
    const result = applyHardPoint(currentGame, winner);
    nextGame = result.game;
    gameWon = result.won;
  }

  if (!gameWon) {
    return { ...state, currentGame: nextGame, sets };
  }

  // Tally game win
  const updatedSet: SetScore = {
    ...currentSet,
    gamesPlayer: winner === 'player' ? currentSet.gamesPlayer + 1 : currentSet.gamesPlayer,
    gamesOpponent: winner === 'opponent' ? currentSet.gamesOpponent + 1 : currentSet.gamesOpponent,
    tiebreakScore: currentGame.isTiebreak
      ? { player: currentGame.player as number, opponent: currentGame.opponent as number }
      : currentSet.tiebreakScore,
  };

  if (!isSetOver(updatedSet.gamesPlayer, updatedSet.gamesOpponent, config)) {
    sets[setIdx] = updatedSet;
    const resetGame = tiebreakNeeded ? makeEmptyGame(config) : nextGame;
    return { ...state, currentGame: resetGame, sets };
  }

  const setWinner = updatedSet.gamesPlayer > updatedSet.gamesOpponent ? 'player' : 'opponent';
  const completedSet: SetScore = { ...updatedSet, completed: true, winner: setWinner };
  sets[setIdx] = completedSet;

  const setsWonPlayer = sets.filter((s) => s.winner === 'player').length;
  const setsWonOpponent = sets.filter((s) => s.winner === 'opponent').length;

  if (setsWonPlayer >= config.setsToWin) {
    return { ...state, currentGame: makeEmptyGame(config), sets, matchWinner: 'player' };
  }
  if (setsWonOpponent >= config.setsToWin) {
    return { ...state, currentGame: makeEmptyGame(config), sets, matchWinner: 'opponent' };
  }

  return {
    ...state,
    currentGame: makeEmptyGame(config),
    sets: [...sets, makeInitialSet()],
    currentSetIndex: setIdx + 1,
  };
}

export function computeMatchScore(
  points: PointRecord[],
  sport: 'tennis' | 'softTennis'
): MatchScore {
  const config = sport === 'softTennis' ? SOFT_TENNIS_CONFIG : HARD_TENNIS_CONFIG;
  let state = initMatchScore(config);
  for (const point of points) {
    state = applyPoint(state, point.outcome);
  }
  return state;
}

export function formatGameScore(game: GameScore): string {
  return `${game.player}-${game.opponent}`;
}

export function formatSetScoreLine(sets: SetScore[]): string {
  return sets
    .filter((s) => s.completed || s.gamesPlayer > 0 || s.gamesOpponent > 0)
    .map((s) => `${s.gamesPlayer}-${s.gamesOpponent}`)
    .join(' ');
}
