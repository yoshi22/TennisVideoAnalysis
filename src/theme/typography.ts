// Typography — Inter for Latin/numerals, Noto Sans JP for Japanese text.
// Font loading happens in app/_layout.tsx via useFonts.

export const fontFamily = {
  regular: 'Inter_400Regular',
  medium: 'Inter_500Medium',
  semiBold: 'Inter_600SemiBold',
  bold: 'Inter_700Bold',
  jpRegular: 'NotoSansJP_400Regular',
  jpMedium: 'NotoSansJP_500Medium',
  jpSemiBold: 'NotoSansJP_600SemiBold',
  jpBold: 'NotoSansJP_700Bold',
} as const;

// Numeric variant — tabular nums, tight tracking
export const numericStyle = {
  fontVariantNumeric: 'tabular-nums' as const,
  letterSpacing: -0.3,
};

export const textStyle = {
  display: {
    fontFamily: fontFamily.bold,
    fontSize: 40,
    lineHeight: 44,
    ...numericStyle,
  },
  h1: {
    fontFamily: fontFamily.bold,
    fontSize: 30,
    lineHeight: 36,
    letterSpacing: -0.4,
  },
  h2: {
    fontFamily: fontFamily.bold,
    fontSize: 22,
    lineHeight: 28,
    letterSpacing: -0.3,
  },
  h3: {
    fontFamily: fontFamily.semiBold,
    fontSize: 17,
    lineHeight: 22,
    letterSpacing: -0.2,
  },
  body: {
    fontFamily: fontFamily.regular,
    fontSize: 14,
    lineHeight: 20,
  },
  bodyStrong: {
    fontFamily: fontFamily.semiBold,
    fontSize: 14,
    lineHeight: 20,
  },
  caption: {
    fontFamily: fontFamily.regular,
    fontSize: 12,
    lineHeight: 16,
  },
  captionStrong: {
    fontFamily: fontFamily.semiBold,
    fontSize: 12,
    lineHeight: 16,
  },
  label: {
    fontFamily: fontFamily.semiBold,
    fontSize: 11,
    lineHeight: 14,
    letterSpacing: 0.02,
  },
  num: {
    fontFamily: fontFamily.bold,
    ...numericStyle,
  },
} as const;

// Legacy compat — old code importing from @/theme can still use 'typography'
export const typography = textStyle;
