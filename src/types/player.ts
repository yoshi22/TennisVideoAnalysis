export type SportType = 'tennis' | 'softTennis';
export type PlayStyle = 'baseline' | 'serve-volley' | 'allcourt';
// 前衛/後衛ではなくフォア側/バック側
export type SoftTennisPosition = 'forehand' | 'backhand';
export type MatchFormat = 'singles' | 'doubles';

export interface PlayerProfile {
  id: string;
  name: string;
  sport: SportType;
  playStyle: PlayStyle;
  dominantHand: 'right' | 'left';
  // ISO 8601
  createdAt: string;
  updatedAt: string;
}
