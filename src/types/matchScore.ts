export type TennisPointScore = '0' | '15' | '30' | '40' | 'AD';

export interface GameScore {
  player: TennisPointScore | number;
  opponent: TennisPointScore | number;
  isTiebreak: boolean;
}

export interface SetScore {
  gamesPlayer: number;
  gamesOpponent: number;
  tiebreakScore?: { player: number; opponent: number };
  completed: boolean;
  winner?: 'player' | 'opponent';
}

export interface MatchScoreConfig {
  sport: 'hard' | 'soft';
  /** Number of sets needed to win the match (hard: 2 for best-of-3, soft: 3) */
  setsToWin: number;
  /** Games needed to win a set (hard: 6, soft: 4) */
  gamesPerSet: number;
  /** Point at which deuce applies (hard: 3 = after 40-40, soft: 3 = after 3-3) */
  deuceAfterPoints: number;
  /** Games at which tiebreak triggers (hard: 6-6, soft: undefined) */
  tiebreakAt?: number;
}

export interface MatchScore {
  currentGame: GameScore;
  sets: SetScore[];
  currentSetIndex: number;
  matchWinner?: 'player' | 'opponent';
  config: MatchScoreConfig;
}

export const HARD_TENNIS_CONFIG: MatchScoreConfig = {
  sport: 'hard',
  setsToWin: 2,
  gamesPerSet: 6,
  deuceAfterPoints: 3,
  tiebreakAt: 6,
};

export const SOFT_TENNIS_CONFIG: MatchScoreConfig = {
  sport: 'soft',
  setsToWin: 3,
  gamesPerSet: 4,
  deuceAfterPoints: 3,
  tiebreakAt: undefined,
};
