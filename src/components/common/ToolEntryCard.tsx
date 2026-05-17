import { Ionicons } from '@expo/vector-icons';
import { type ComponentProps } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { useTheme } from '@/theme';

type IoniconName = ComponentProps<typeof Ionicons>['name'];

interface ToolEntryCardProps {
  iconName: IoniconName;
  title: string;
  subtitle: string;
  onPress: () => void;
  badgeLabel?: string;
  accessibilityLabel?: string;
}

export function ToolEntryCard({
  iconName,
  title,
  subtitle,
  onPress,
  badgeLabel,
  accessibilityLabel,
}: ToolEntryCardProps) {
  const { colors } = useTheme();

  return (
    <TouchableOpacity
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityRole="button"
      activeOpacity={0.88}
      onPress={onPress}
      style={[
        styles.card,
        {
          backgroundColor: colors.surface,
          borderColor: colors.border,
          shadowColor: colors.text,
        },
      ]}
    >
      <View style={[styles.iconWrap, { backgroundColor: colors.primaryLo }]}>
        <Ionicons color={colors.primary} name={iconName} size={22} />
      </View>
      <View style={styles.textWrap}>
        <View style={styles.titleRow}>
          <Text style={[styles.title, { color: colors.text }]} numberOfLines={1}>
            {title}
          </Text>
          {badgeLabel ? (
            <View style={[styles.badge, { backgroundColor: colors.primaryLo }]}>
              <Text style={[styles.badgeText, { color: colors.primary }]}>{badgeLabel}</Text>
            </View>
          ) : null}
        </View>
        <Text style={[styles.subtitle, { color: colors.textSub }]} numberOfLines={2}>
          {subtitle}
        </Text>
      </View>
      <Ionicons color={colors.textMuted} name="chevron-forward" size={20} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    alignItems: 'center',
    borderRadius: 14,
    borderWidth: 0.5,
    elevation: 1,
    flexDirection: 'row',
    gap: 12,
    padding: 14,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
  },
  iconWrap: {
    alignItems: 'center',
    borderRadius: 12,
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  textWrap: {
    flex: 1,
    minWidth: 0,
  },
  titleRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  title: {
    flexShrink: 1,
    fontSize: 15,
    fontWeight: '700',
  },
  badge: {
    borderRadius: 999,
    flexShrink: 0,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '700',
    lineHeight: 14,
  },
  subtitle: {
    fontSize: 12,
    lineHeight: 18,
    marginTop: 2,
  },
});
