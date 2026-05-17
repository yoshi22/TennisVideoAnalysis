import { StyleSheet, Text, View } from 'react-native';

import { formatGameScore, formatSetScoreLine } from '@/services/scoring';
import { useTheme } from '@/theme';
import { type MatchScore } from '@/types';

interface MatchScoreboardProps {
  matchScore: MatchScore;
  playerName?: string;
}

export function MatchScoreboard({ matchScore, playerName = 'プレイヤー' }: MatchScoreboardProps) {
  const { colors } = useTheme();
  const gameScore = formatGameScore(matchScore.currentGame);
  const setScore = formatSetScoreLine(matchScore.sets) || '0-0';
  const winnerText =
    matchScore.matchWinner === undefined
      ? null
      : matchScore.matchWinner === 'player'
        ? `試合終了: ${playerName}の勝ち`
        : '試合終了: 相手の勝ち';

  return (
    <View
      accessibilityLabel={winnerText ?? `現在の試合スコア ${gameScore} セット ${setScore}`}
      style={[
        styles.container,
        {
          backgroundColor: colors.surface,
          borderColor: colors.border,
          shadowColor: colors.text,
        },
      ]}
    >
      <Text style={[styles.label, { color: colors.textMuted }]}>MATCH SCORE</Text>
      <Text style={[styles.score, { color: colors.text }]}>
        {gameScore} | {setScore}
      </Text>
      {winnerText ? (
        <Text style={[styles.winner, { color: colors.primary }]}>{winnerText}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    borderRadius: 14,
    borderWidth: 0.5,
    elevation: 1,
    padding: 14,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
  },
  label: {
    fontSize: 10,
    fontWeight: '700',
    marginBottom: 6,
    textTransform: 'uppercase',
  },
  score: {
    fontSize: 22,
    fontVariant: ['tabular-nums'],
    fontWeight: '700',
  },
  winner: {
    fontSize: 13,
    fontWeight: '700',
    marginTop: 8,
  },
});
