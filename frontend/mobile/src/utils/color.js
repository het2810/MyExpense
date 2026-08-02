/**
 * Color math for components that need a fill the token set does not name
 * directly — kept in one place so no component ships a second copy of it.
 *
 * **Nothing here introduces a color.** Every value these functions return is a
 * blend of two values that are already `theme.color.*` tokens, which is what
 * keeps a derived fill inside the design system (docs/ui/design-system.md §3:
 * only colors change between the two themes, so a blend of two tokens flips
 * with the theme exactly as its inputs do).
 *
 * **Extracted from `components/ProgressBar.jsx`, not newly invented**
 * (constitution §25 — the second caller is the threshold). ProgressBar has
 * interpolated its budget-usage fill across `accent.primary → status.warning →
 * status.negative` since the Dashboard shipped; the Statistics donut's slice
 * palette needs the same blend to fill the hue gaps between the four tokens
 * that carry a hue (`utils/chartPalette.js`). The math and the returned string
 * format are unchanged, so ProgressBar renders exactly as it did.
 *
 * Pure functions only: no React, no theme import. Callers pass token values in.
 *
 * `pickReadableTextColor` (2026-11-01) follows the same rule from the other
 * direction: it never returns a color of its own either, only whichever of two
 * tokens the caller gave it reads better on a given fill.
 */

/**
 * Blends two `#rrggbb` theme token colors.
 *
 * `rgb(...)` rather than hex because that is the format ProgressBar has always
 * produced, and both React Native styles and react-native-svg's `fill`/`stroke`
 * accept it.
 *
 * `t` is clamped, so a caller's rounding error cannot produce a channel outside
 * `0..255` and therefore an unparseable color string.
 *
 * @param {string} hexStart `#rrggbb`
 * @param {string} hexEnd `#rrggbb`
 * @param {number} t 0 = `hexStart`, 1 = `hexEnd`.
 * @returns {string} e.g. 'rgb(34, 225, 240)'
 */
export function mixHexColors(hexStart, hexEnd, t) {
  const ratio = Math.max(0, Math.min(1, t));
  const start = hexToRgb(hexStart);
  const end = hexToRgb(hexEnd);
  const r = lerpChannel(start.r, end.r, ratio);
  const g = lerpChannel(start.g, end.g, ratio);
  const b = lerpChannel(start.b, end.b, ratio);
  return `rgb(${r}, ${g}, ${b})`;
}

/**
 * Picks whichever of two caller-supplied token colors is more readable **on**
 * the given background color.
 *
 * Added for the Statistics legend's percentage chip (2026-11-01), whose fill is
 * the category's own slice color: the slice palette is a ramp from
 * `status.negative` through `status.warning` and `status.positive` to
 * `accent.primary`, so one fixed label color is legible on part of that ramp and
 * not on the rest — and differently so in each theme, where those four tokens
 * have deliberately different lightness.
 *
 * **It introduces no color.** It returns one of the two values it was handed,
 * both of which the caller reads from `theme.color.*`, so the design system
 * still decides what the two options are (the same discipline `mixHexColors`
 * keeps).
 *
 * Decided by **WCAG relative-luminance contrast ratio against each candidate**,
 * higher wins, rather than by a lightness threshold: a threshold has to be
 * tuned per candidate pair and silently stops being right when a token changes,
 * while the ratio is the same measurement an accessibility audit would make.
 *
 * Accepts `#rrggbb` and the `rgb(r, g, b)` form `mixHexColors` returns, because
 * a palette entry can be either.
 *
 * @param {string} backgroundColor The fill the text sits on.
 * @param {string} candidateA A `theme.color.*` value.
 * @param {string} candidateB A `theme.color.*` value.
 * @returns {string} `candidateA` or `candidateB`, ties to `candidateA`.
 */
export function pickReadableTextColor(backgroundColor, candidateA, candidateB) {
  const background = parseColor(backgroundColor);
  const contrastA = getContrastRatio(background, parseColor(candidateA));
  const contrastB = getContrastRatio(background, parseColor(candidateB));
  return contrastA >= contrastB ? candidateA : candidateB;
}

/** `#rrggbb` or `rgb(r, g, b)` to channels. */
function parseColor(color) {
  if (typeof color === 'string' && color.startsWith('rgb')) {
    const [r = 0, g = 0, b = 0] = color
      .replace(/[^0-9,]/g, '')
      .split(',')
      .map(Number);
    return { r, g, b };
  }
  return hexToRgb(color);
}

/** WCAG 2.1 contrast ratio — 1 (identical) to 21 (black on white). */
function getContrastRatio(first, second) {
  const firstLuminance = getRelativeLuminance(first);
  const secondLuminance = getRelativeLuminance(second);
  const lighter = Math.max(firstLuminance, secondLuminance);
  const darker = Math.min(firstLuminance, secondLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

/** WCAG 2.1 relative luminance, gamma-corrected per channel. */
function getRelativeLuminance({ r, g, b }) {
  return (
    0.2126 * toLinearChannel(r) + 0.7152 * toLinearChannel(g) + 0.0722 * toLinearChannel(b)
  );
}

function toLinearChannel(value) {
  const normalized = Math.max(0, Math.min(255, value)) / 255;
  return normalized <= 0.03928
    ? normalized / 12.92
    : Math.pow((normalized + 0.055) / 1.055, 2.4);
}

function hexToRgb(hex) {
  const sanitized = hex.replace('#', '');
  const value = parseInt(sanitized, 16);
  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255,
  };
}

function lerpChannel(start, end, ratio) {
  return Math.round(start + (end - start) * ratio);
}
