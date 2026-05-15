import { type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { useTheme } from '@/theme';

import { CourtLines } from './CourtLines';
import { ProgressRing } from './ProgressRing';
import { Sparkline } from './Sparkline';

export interface StatCardData {
  label: string;
  value: string | number;
  unit?: string;
  delta?: number;
  trend?: number[];
}

interface StatCardProps {
  stat: StatCardData;
  variant?: 'numeric' | 'spark' | 'ring';
  icon?: ReactNode;
  width?: number;
}

export function StatCard({ stat, variant = 'numeric', icon, width = 152 }: StatCardProps) {
  const { colors } = useTheme();
  const { label, value, unit, delta, trend } = stat;
  const up = (delta ?? 0) > 0;
  const dn = (delta ?? 0) < 0;
  const deltaColor = up ? colors.success : dn ? colors.danger : colors.textMuted;

  if (variant === 'ring') {
    const pct =
      typeof value === 'number' && unit === '%'
        ? value / 100
        : typeof value === 'number'
          ? value
          : 0;
    return (
      <View
        style={[
          styles.card,
          { backgroundColor: colors.surface, borderColor: colors.border, width },
        ]}
      >
        <View style={styles.rowBetween}>
          <Text style={[styles.label, { color: colors.textSub }]}>{label}</Text>
          {icon ? (icon as ReactNode) : null}
        </View>
        <View style={[styles.row, { gap: 12, marginTop: 10 }]}>
          <ProgressRing value={pct} size={48} stroke={5} color={colors.primary}>
            <Text style={[styles.ringInner, { color: colors.text }]}>{value}</Text>
          </ProgressRing>
          <View>
            <Text style={[styles.bigNum, { color: colors.text }]}>
              {value}
              <Text style={[styles.unit, { color: colors.textSub }]}> {unit}</Text>
            </Text>
            {delta != null && (
              <Text style={[styles.delta, { color: deltaColor }]}>
                {up ? '↑' : dn ? '↓' : '—'} {Math.abs(delta)}
              </Text>
            )}
          </View>
        </View>
      </View>
    );
  }

  if (variant === 'spark') {
    return (
      <View
        style={[
          styles.card,
          { backgroundColor: colors.surface, borderColor: colors.border, width },
        ]}
      >
        <View style={[styles.rowBetween, { marginBottom: 6 }]}>
          <Text style={[styles.label, { color: colors.textSub }]}>{label}</Text>
          {icon ? (icon as ReactNode) : null}
        </View>
        <Text style={[styles.sparkNum, { color: colors.text }]}>
          {value}
          <Text style={[styles.sparkUnit, { color: colors.textSub }]}> {unit}</Text>
        </Text>
        <View style={[styles.rowBetween, { marginTop: 10, alignItems: 'flex-end' }]}>
          {delta != null && (
            <Text style={[styles.delta, { color: deltaColor }]}>
              {up ? '↑' : dn ? '↓' : '—'} {Math.abs(delta)}
            </Text>
          )}
          {trend && trend.length > 1 ? (
            <Sparkline
              data={trend}
              width={68}
              height={22}
              color={colors.primary}
              fillOpacity={0.15}
            />
          ) : null}
        </View>
      </View>
    );
  }

  // numeric — boldest numerals
  return (
    <View
      style={[
        styles.card,
        styles.numericCard,
        { backgroundColor: colors.surface, borderColor: colors.border, width },
      ]}
    >
      {/* faint court motif */}
      <View style={styles.courtMotif} pointerEvents="none">
        <CourtLines
          stroke={colors.text}
          strokeOpacity={0.06}
          strokeWidth={1.2}
          width={80}
          height={80}
        />
      </View>
      <View style={[styles.row, { gap: 6, marginBottom: 8 }]}>
        {icon ? (icon as ReactNode) : null}
        <Text style={[styles.label, { color: colors.textSub }]}>{label}</Text>
      </View>
      <Text style={[styles.displayNum, { color: colors.text }]}>
        {value}
        <Text style={[styles.displayUnit, { color: colors.textSub }]}> {unit}</Text>
      </Text>
      {delta != null && (
        <View style={[styles.row, { gap: 4, marginTop: 8 }]}>
          <View
            style={[
              styles.deltaBadge,
              {
                backgroundColor: up
                  ? `${colors.success}22`
                  : dn
                    ? `${colors.danger}22`
                    : 'transparent',
              },
            ]}
          >
            <Text style={{ fontSize: 10, color: deltaColor }}>{up ? '↑' : dn ? '↓' : '—'}</Text>
          </View>
          <Text style={[styles.delta, { color: deltaColor }]}>{Math.abs(delta)} 前回比</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: 16,
    borderRadius: 14,
    borderWidth: 0.5,
    shadowColor: '#0F281C',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 1,
    flexShrink: 0,
  },
  numericCard: {
    position: 'relative',
    overflow: 'hidden',
  },
  courtMotif: {
    position: 'absolute',
    right: -22,
    top: -22,
    width: 80,
    height: 80,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  label: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.02,
  },
  bigNum: {
    fontSize: 28,
    fontWeight: '700',
    lineHeight: 32,
    letterSpacing: -0.3,
  },
  unit: {
    fontSize: 14,
    fontWeight: '400',
  },
  sparkNum: {
    fontSize: 34,
    fontWeight: '700',
    lineHeight: 36,
    letterSpacing: -0.3,
  },
  sparkUnit: {
    fontSize: 15,
    fontWeight: '600',
  },
  displayNum: {
    fontSize: 40,
    fontWeight: '700',
    lineHeight: 44,
    letterSpacing: -0.3,
  },
  displayUnit: {
    fontSize: 16,
    fontWeight: '600',
  },
  delta: {
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0.02,
  },
  deltaBadge: {
    width: 14,
    height: 14,
    borderRadius: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ringInner: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: -0.3,
  },
});
