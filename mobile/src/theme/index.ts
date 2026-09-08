/**
 * Фирменный стиль ArchiPaint.
 * Токены совпадают с переменными assets/css/podbor.css, чтобы приложение
 * и сайт выглядели одинаково.
 */

export const colors = {
  ink: '#20241F',
  inkMuted: '#5E6359',
  inkFaint: '#8A8F84',
  paper: '#FAFAF7',
  card: '#FFFFFF',
  line: '#E3E4DC',
  accent: '#3E4A3D',
  accentPressed: '#2E382D',
  accentSoft: '#EDF1E9',
  terra: '#8C4A3E',
  terraSoft: '#F6EAE7',
  good: '#4F8A5B',
  mid: '#C08A2E',
  poor: '#B4523F',
  white: '#FFFFFF',
} as const;

export const radius = {
  sm: 9,
  md: 14,
  lg: 20,
  pill: 999,
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const typography = {
  h1: { fontSize: 26, fontWeight: '700' as const, color: colors.ink },
  h2: { fontSize: 20, fontWeight: '700' as const, color: colors.ink },
  h3: { fontSize: 16, fontWeight: '600' as const, color: colors.ink },
  body: { fontSize: 15, fontWeight: '400' as const, color: colors.ink },
  caption: { fontSize: 13, fontWeight: '400' as const, color: colors.inkMuted },
  micro: { fontSize: 11, fontWeight: '500' as const, color: colors.inkFaint },
  mono: {
    fontSize: 13,
    color: colors.inkMuted,
    fontFamily: undefined as string | undefined,
    letterSpacing: 0.4,
  },
};

export const shadow = {
  card: {
    shadowColor: '#20241F',
    shadowOpacity: 0.07,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
};

export const theme = { colors, radius, spacing, typography, shadow };
export default theme;
