import { createContext, useContext, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';

import { darkColors, lightColors, type ColorTokens } from './colors';

interface ThemeContextValue {
  colors: ColorTokens;
  mode: 'light' | 'dark';
  withAlpha: (hex: string, alpha: number) => string;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function withAlpha(hex: string, alpha: number): string {
  const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255)
    .toString(16)
    .padStart(2, '0')
    .toUpperCase();
  return `${hex}${a}`;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const scheme = useColorScheme();
  const mode = scheme === 'dark' ? 'dark' : 'light';
  const colorsMap: ColorTokens = mode === 'dark' ? darkColors : lightColors;

  return (
    <ThemeContext.Provider value={{ colors: colorsMap, mode, withAlpha }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider');
  return ctx;
}
