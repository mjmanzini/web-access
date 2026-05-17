/**
 * Khuloh "Safe Home" theme — soft blues & greens, bold clear typography.
 */

export const T = {
  // ── Backgrounds ──
  bg: "#0C1A27",
  surface: "#15283A",
  surfaceLight: "#1D3347",
  inputBg: "#13242F",

  // ── Primary (safe green) ──
  primary: "#2FAF7B",
  primaryMuted: "#2FAF7B33",

  // ── Accent (soft blue) ──
  accent: "#4DABCF",
  accentMuted: "#4DABCF22",

  // ── Text ──
  text: "#E8EFF4",
  textSecondary: "#7D95A8",
  textMuted: "#4D6778",

  // ── Borders ──
  border: "#223A4D",
  borderLight: "#2B4A5E",

  // ── Semantic ──
  success: "#4ADE80",
  danger: "#EF5350",
  warning: "#FFB74D",

  // ── Tab bar ──
  tabBg: "#0A1520",
  tabActive: "#2FAF7B",
  tabInactive: "#4D6778",

  // ── Chat bubbles ──
  bubbleMe: "#1B6B52",
  bubbleOther: "#1D3347",

  // ── Send button ──
  send: "#2FAF7B",
} as const;

export type ThemeColors = typeof T;
