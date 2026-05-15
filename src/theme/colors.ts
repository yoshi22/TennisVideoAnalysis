// Refined Court palette — light + dark
const _lightColors = {
  bg: '#F4F5F1',
  surface: '#FFFFFF',
  surfaceAlt: '#ECEEE7',
  surfaceHover: '#ECEEE7', // alias for surfaceAlt (compat)
  border: '#E2E5DA',
  text: '#15201A',
  textSub: '#5E6A60',
  textMuted: '#94A097',
  textDisabled: '#94A097', // alias for textMuted (compat)
  primary: '#1F6F4A',
  primaryLo: '#D7EADF',
  accent: '#0F2B5B',
  success: '#1F8A5B',
  danger: '#C4453E',
  warning: '#C97A12',
  chartA: '#1F6F4A',
  chartB: '#0F2B5B',
  chartC: '#C97A12',
  heatLo: '#E9EFE7',
  heatHi: '#1F6F4A',
  court: '#3A7A56',
  courtLine: '#FFFFFF',
  courtSurface: '#3A7A56', // alias for court (compat)
  courtNet: '#C4453E', // alias for danger (compat)
  courtBlue: '#2563EB', // shot-type blue (compat)
  courtPurple: '#7C3AED', // shot-type purple (compat)
  courtCyan: '#0891B2', // shot-type cyan (compat)
  navyLight: '#1A4080', // soft-tennis court alt (compat)
  softAccent: '#5B6CFF', // category accent (compat)
  overlay: 'rgba(21, 32, 26, 0.5)',
  tabBg: '#FFFFFFF2',
  tabBorder: '#E2E5DA',
};

const _darkColors = {
  bg: '#0E1411',
  surface: '#181F1B',
  surfaceAlt: '#222A25',
  surfaceHover: '#222A25',
  border: '#2A332D',
  text: '#ECF3EE',
  textSub: '#9AA89E',
  textMuted: '#6A7770',
  textDisabled: '#6A7770',
  primary: '#3FB37B',
  primaryLo: '#1B2F25',
  accent: '#7AA0FF',
  success: '#3FB37B',
  danger: '#E36B65',
  warning: '#E5A04A',
  chartA: '#3FB37B',
  chartB: '#7AA0FF',
  chartC: '#E5A04A',
  heatLo: '#1A2620',
  heatHi: '#3FB37B',
  court: '#1F5A3E',
  courtLine: '#9CC4AF',
  courtSurface: '#1F5A3E',
  courtNet: '#E36B65',
  courtBlue: '#60A5FA',
  courtPurple: '#A78BFA',
  courtCyan: '#22D3EE',
  navyLight: '#60A5FA',
  softAccent: '#818CF8',
  overlay: 'rgba(0, 0, 0, 0.6)',
  tabBg: '#161D19F2',
  tabBorder: '#2A332D',
};

export const lightColors: ColorTokens = _lightColors;
export const darkColors: ColorTokens = _darkColors;

// Widened type — string values so light and dark can be used interchangeably
export type ColorTokens = { [K in keyof typeof _lightColors]: string };
export type ColorKey = keyof ColorTokens;

// Legacy flat alias kept for old imports during migration
export const colors: ColorTokens = lightColors;
