import { Ionicons } from '@expo/vector-icons';
import { type ReactNode } from 'react';
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '@/theme';

import { CourtLines } from './CourtLines';

interface ScreenHeroProps {
  eyebrow?: string;
  title?: string | ReactNode;
  subtitle?: string | ReactNode;
  right?: ReactNode;
  onBack?: () => void;
  topInset?: boolean;
  motif?: boolean;
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  motifStrokeOpacity?: number;
  motifStyle?: StyleProp<ViewStyle>;
}

export function ScreenHero({
  eyebrow,
  title,
  subtitle,
  right,
  onBack,
  topInset = true,
  motif = true,
  children,
  style,
  motifStrokeOpacity = 0.12,
  motifStyle,
}: ScreenHeroProps) {
  const { colors, withAlpha } = useTheme();
  const insets = useSafeAreaInsets();
  const hasTopRow = Boolean(eyebrow || onBack);

  return (
    <View
      style={[
        styles.hero,
        {
          backgroundColor: colors.hero,
          paddingTop: topInset ? insets.top + 16 : 16,
        },
        style,
      ]}
    >
      {motif ? (
        <View style={[styles.heroMotif, motifStyle]} pointerEvents="none">
          <CourtLines stroke={colors.onHero} strokeOpacity={motifStrokeOpacity} strokeWidth={1.4} />
        </View>
      ) : null}

      {hasTopRow ? (
        <View style={styles.topRow}>
          {onBack ? (
            <TouchableOpacity
              accessibilityLabel="戻る"
              accessibilityRole="button"
              onPress={onBack}
              style={styles.backButton}
            >
              <Ionicons color={colors.heroAccent} name="chevron-back" size={24} />
            </TouchableOpacity>
          ) : null}
          {eyebrow ? (
            <Text style={[styles.eyebrow, { color: colors.heroAccent }]}>{eyebrow}</Text>
          ) : null}
        </View>
      ) : null}

      {title || subtitle || right ? (
        <View style={styles.titleRow}>
          <View style={styles.titleBlock}>
            {typeof title === 'string' ? (
              <Text style={[styles.title, { color: colors.onHero }]}>{title}</Text>
            ) : (
              title
            )}
            {typeof subtitle === 'string' ? (
              <Text style={[styles.subtitle, { color: withAlpha(colors.onHero, 0.68) }]}>
                {subtitle}
              </Text>
            ) : (
              subtitle
            )}
          </View>
          {right ? <View style={styles.right}>{right}</View> : null}
        </View>
      ) : null}

      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  hero: {
    borderRadius: 14,
    overflow: 'hidden',
    padding: 16,
    position: 'relative',
  },
  heroMotif: {
    height: 120,
    position: 'absolute',
    right: -20,
    top: -16,
    width: 240,
  },
  topRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  backButton: {
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: -8,
    minHeight: 32,
    minWidth: 32,
  },
  eyebrow: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0,
  },
  titleRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
  },
  titleBlock: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    lineHeight: 30,
    marginTop: 8,
  },
  subtitle: {
    fontSize: 13,
    fontWeight: '700',
    marginTop: 8,
  },
  right: {
    alignItems: 'flex-end',
  },
});
