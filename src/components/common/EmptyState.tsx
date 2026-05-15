import { StyleSheet, Text, View } from 'react-native';

import { useTheme } from '@/theme';

import { Button } from './Button';

interface EmptyStateProps {
  title: string;
  description?: string;
  action?: { label: string; onPress: () => void };
  /** Legacy icon name — accepted but not rendered in new design */
  icon?: string;
}

export function EmptyState({ title, description, action }: EmptyStateProps) {
  const { colors } = useTheme();

  return (
    <View style={styles.container}>
      <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
      {description ? (
        <Text style={[styles.description, { color: colors.textSub }]}>{description}</Text>
      ) : null}
      {action ? (
        <Button
          accessibilityLabel={action.label}
          label={action.label}
          onPress={action.onPress}
          style={styles.button}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
    textAlign: 'center',
  },
  description: {
    fontSize: 14,
    marginTop: 8,
    textAlign: 'center',
    lineHeight: 20,
  },
  button: {
    marginTop: 20,
  },
});
