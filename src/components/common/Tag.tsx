import { type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

interface TagProps {
  children: ReactNode;
  color?: string;
  bg?: string;
  border?: string;
}

export function Tag({ children, color, bg, border }: TagProps) {
  return (
    <View
      style={[
        styles.base,
        {
          backgroundColor: bg ?? 'transparent',
          borderColor: border,
          borderWidth: border ? 1 : 0,
        },
      ]}
    >
      <Text style={[styles.label, { color: color }]}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
  },
  label: {
    fontSize: 11,
    fontWeight: '600',
    lineHeight: 14,
    letterSpacing: 0.02,
  },
});
