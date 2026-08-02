import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useTheme } from '../theme/useTheme';

/**
 * Read-only linear budget-usage indicator (e.g. monthly budget bar on the
 * Dashboard). The interactive two-handle range slider (Budget Settings) is
 * a materially different, deferred component — see ADR 0001.
 * See docs/decisions/0001-shared-component-library.md.
 *
 * @param {number} progress - 0..1 (values above 1 are clamped for display).
 * @param {'accent'|'warning'|'negative'} [tone] - Fixed fill color for
 *   callers that don't want progress-driven coloring (e.g. a future generic
 *   category cap bar). When omitted, the fill color is instead
 *   interpolated across theme tokens based on `progress` — see
 *   `interpolateProgressColor` below. Dashboard's monthly budget bar uses
 *   this default dynamic mode.
 */
function ProgressBar({ progress = 0, tone, style }) {
  const theme = useTheme();
  const clamped = Math.max(0, Math.min(1, progress));
  const fillColor = tone
    ? resolveFillColor(theme, tone)
    : interpolateProgressColor(theme, clamped);
  const styles = createStyles(theme, fillColor);

  return (
    <View style={[styles.track, style]}>
      <View style={[styles.fill, { width: `${clamped * 100}%` }]} />
    </View>
  );
}

function resolveFillColor(theme, tone) {
  switch (tone) {
    case 'warning':
      return theme.color.status.warning;
    case 'negative':
      return theme.color.status.negative;
    default:
      return theme.color.accent.primary;
  }
}

// Percentage of budget at which the fill color has fully shifted from
// accent.primary to status.warning; beyond this it shifts on to
// status.negative as progress approaches (and exceeds) 100%.
const WARNING_BREAKPOINT = 0.8;

/**
 * Smoothly interpolates the bar's fill color across the three existing
 * status/accent theme tokens as `clampedProgress` (0..1) increases:
 *   0            -> theme.color.accent.primary   (blue/cyan)
 *   WARNING_BREAKPOINT (~0.8) -> theme.color.status.warning (amber)
 *   1            -> theme.color.status.negative  (red)
 * No new colors are introduced — only RGB-lerping between existing tokens.
 */
function interpolateProgressColor(theme, clampedProgress) {
  if (clampedProgress <= WARNING_BREAKPOINT) {
    const t = clampedProgress / WARNING_BREAKPOINT;
    return lerpColor(theme.color.accent.primary, theme.color.status.warning, t);
  }
  const t = (clampedProgress - WARNING_BREAKPOINT) / (1 - WARNING_BREAKPOINT);
  return lerpColor(theme.color.status.warning, theme.color.status.negative, t);
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

function lerp(start, end, t) {
  return Math.round(start + (end - start) * t);
}

/**
 * Linearly interpolates between two `#rrggbb` theme token colors at
 * fraction `t` (0..1) and returns an `rgb(...)` string.
 */
function lerpColor(hexStart, hexEnd, t) {
  const start = hexToRgb(hexStart);
  const end = hexToRgb(hexEnd);
  return `rgb(${lerp(start.r, end.r, t)}, ${lerp(start.g, end.g, t)}, ${lerp(start.b, end.b, t)})`;
}

function createStyles(theme, fillColor) {
  return StyleSheet.create({
    track: {
      height: 8,
      borderRadius: theme.radius.sm,
      backgroundColor: theme.color.background.surfaceAlt,
      overflow: 'hidden',
    },
    fill: {
      height: '100%',
      borderRadius: theme.radius.sm,
      backgroundColor: fillColor,
    },
  });
}

export default ProgressBar;
