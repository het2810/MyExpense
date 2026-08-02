/**
 * Design tokens for MyExpense.
 *
 * Source of truth: docs/ui/design-system.md (Sections 1-3).
 * Two flat token objects (`darkTheme`, `lightTheme`) share an identical key
 * shape so any component can read `theme.color.background.base` etc.
 * regardless of the active theme — per design-system.md Section 3, "only
 * colors change" between themes. Typography, spacing, and radius scales are
 * defined once and shared by both themes.
 *
 * Components must always read colors/spacing/type from these tokens via
 * `useTheme()` (src/theme/useTheme.js) — never hardcode values.
 */

// Shared across both themes — design-system.md Section 1.2.
const type = {
  display: { fontSize: 32, lineHeight: 40, fontWeight: '700' },
  h1: { fontSize: 24, lineHeight: 30, fontWeight: '700' },
  h2: { fontSize: 18, lineHeight: 24, fontWeight: '600' },
  bodyLg: { fontSize: 16, lineHeight: 22, fontWeight: '600' },
  body: { fontSize: 14, lineHeight: 20, fontWeight: '400' },
  label: {
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  caption: { fontSize: 11, lineHeight: 14, fontWeight: '400' },
  button: { fontSize: 16, lineHeight: 20, fontWeight: '700' },
};

// Shared across both themes — design-system.md Section 1.3 (4px base unit).
const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
};

// Shared across both themes — design-system.md Section 1.4.
const radius = {
  sm: 8,
  md: 14,
  lg: 20,
  pill: 999,
  circle: 9999, // treated as "fully round" (paired with equal width/height)
};

// design-system.md Section 1.1 (dark theme — primary, as designed in the PDF).
export const darkTheme = {
  mode: 'dark',
  color: {
    background: {
      base: '#000000',
      surface: '#15191B',
      surfaceAlt: '#1D2225',
    },
    border: {
      subtle: '#262C2F',
    },
    accent: {
      primary: '#22E1F0',
      onPrimary: '#06252B',
      // Dark theme reuses the bright cyan for standalone text/links directly
      // (design-system.md Section 1.1: accent.primary is used for "links" and
      // "positive amounts" as-is — no separate deepened variant is needed
      // against a near-black background). Kept as its own key so both themes
      // share the same shape (Section 3).
      text: '#22E1F0',
    },
    text: {
      primary: '#F5F8F8',
      secondary: '#94A0A3',
      tertiary: '#6A7679',
    },
    status: {
      negative: '#FF6B6B',
      positive: '#34D399',
      warning: '#E2A93B',
      success: '#34D399',
      // White text/icon drawn on a solid status.negative fill — the
      // notification unread-badge count and PrimaryButton's destructive
      // `tone="negative"` label both need this (docs/decisions/
      // 0012-notifications-system.md §4, reused by docs/decisions/
      // 0013-confirmation-dialog-and-free-tier-polish.md §2). Fixed value,
      // both themes — same "the fill itself already carries the theme's
      // contrast decision, the text on top of it doesn't need to" reasoning
      // as accent.onPrimary.
      onNegative: '#FFFFFF',
    },
    overlay: {
      glow: 'rgba(34, 225, 240, 0.35)',
      // Modal backdrop dimmer for ConfirmationDialog — docs/ui/design-system.md
      // §16. Fixed, semi-transparent black, same value both themes (a
      // backdrop's job is to darken whatever is beneath it regardless of the
      // active theme) — distinct from overlay.glow, which is a brand/CTA
      // effect, not a dimmer.
      scrim: 'rgba(0, 0, 0, 0.6)',
    },
  },
  type,
  space,
  radius,
};

// design-system.md Section 2.1 (light theme — derived, not in the PDF).
export const lightTheme = {
  mode: 'light',
  color: {
    background: {
      base: '#F5F7F8',
      surface: '#FFFFFF',
      surfaceAlt: '#EEF2F3',
    },
    border: {
      subtle: '#DFE5E7',
    },
    accent: {
      primary: '#22E1F0',
      onPrimary: '#06252B',
      // Deepened cyan for AA contrast when used as standalone text/links on
      // light surfaces — button fills stay bright (design-system.md 2.1).
      text: '#0E9CAB',
    },
    text: {
      primary: '#12171A',
      secondary: '#59696D',
      tertiary: '#7C8B8F',
    },
    status: {
      negative: '#D64545',
      positive: '#159C6B',
      warning: '#B97B12',
      success: '#159C6B',
      // Same fixed white value as the dark theme — see the dark theme's
      // onNegative comment above.
      onNegative: '#FFFFFF',
    },
    overlay: {
      glow: 'rgba(34, 225, 240, 0.2)',
      // Same fixed scrim value as the dark theme — see the dark theme's
      // overlay.scrim comment above.
      scrim: 'rgba(0, 0, 0, 0.6)',
    },
  },
  type,
  space,
  radius,
};
