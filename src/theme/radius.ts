export const radius = {
  s: 6,
  m: 10,
  l: 14,
  xl: 20,
  pill: 999,
} as const;

export type RadiusKey = keyof typeof radius;
