import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useTheme } from '../theme/useTheme';

/**
 * Previous / next control for the range the Statistics tab is showing, with
 * that range's own label between the two arrows.
 *
 * Added 2026-11-01 for the Project Owner's "in the stats tab I can't view the
 * previous months transaction donut": the tab resolved one range and offered no
 * way to leave it, so every earlier month was unreachable
 * (docs/decisions/0022-statistics-expenses-by-parent-category.md, whose own
 * "there is no range picker this round" note this closes).
 *
 * Feature-specific rather than a base-library primitive, so it is deliberately
 * **not** exported from `components/index.js` — the same line
 * `CategoryDonutChart`/`CategoryBreakdownRow` sit on. It owns no data and makes
 * no decisions: `label` is `formatStatisticsRangeLabel(range)` and the two
 * bounds are the caller's (`useCategoryStatistics`), which is what keeps the
 * label and the figures it captions from ever disagreeing.
 *
 * **`canGoNext: false` is the no-future rule arriving here as a prop**, not a
 * date comparison this component performs. A disabled arrow is rendered dimmed
 * and announces itself as disabled rather than being removed, so the control
 * does not change shape as the user steps — and it takes no press at all, so
 * there is no path where a dead tap looks like a failed one.
 *
 * NOTE on icons: the arrows are `‹`/`›` Text glyphs standing in for
 * `chevron-back-outline`/`chevron-forward-outline` (docs/ui/design-system.md
 * §6) — react-native-vector-icons (ADR 0002) is approved but still not
 * installed, so this follows the same glyph-fallback convention ScreenHeader
 * (←/✕), MainTabs (₹/⇄/P) and ExpandChevron already use.
 *
 * @param {{
 *   label: string,
 *   canGoPrevious?: boolean,
 *   canGoNext: boolean,
 *   onPrevious: () => void,
 *   onNext: () => void,
 *   style?: object,
 * }} props
 */
function StatisticsRangeStepper({
  label,
  canGoPrevious = true,
  canGoNext,
  onPrevious,
  onNext,
  style,
}) {
  const theme = useTheme();
  const styles = createStyles(theme, canGoPrevious, canGoNext);

  return (
    <View style={[styles.stepper, style]}>
      <Pressable
        onPress={canGoPrevious ? onPrevious : undefined}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Previous month"
        accessibilityState={{ disabled: !canGoPrevious }}
        style={styles.arrowTarget}
      >
        <Text style={styles.previousArrow}>‹</Text>
      </Pressable>

      {/* One line, truncated rather than wrapped: the label is as long as its
          two dates and the control must keep its height whichever range is
          shown. */}
      <Text style={styles.label} numberOfLines={1}>
        {label}
      </Text>

      <Pressable
        onPress={canGoNext ? onNext : undefined}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Next month"
        accessibilityState={{ disabled: !canGoNext }}
        style={styles.arrowTarget}
      >
        <Text style={styles.nextArrow}>›</Text>
      </Pressable>
    </View>
  );
}

function createStyles(theme, canGoPrevious, canGoNext) {
  // A dimmed arrow is `text.tertiary` — the token this app already uses for
  // "present but not actionable" (the label captions, the placeholder copy in
  // every trigger field) — rather than an opacity on an accent colour, so the
  // disabled state follows the theme instead of being computed from it.
  const arrow = {
    fontSize: theme.type.h1.fontSize,
    lineHeight: theme.type.h1.lineHeight,
    fontWeight: '700',
  };

  return StyleSheet.create({
    stepper: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: theme.color.background.surfaceAlt,
      borderRadius: theme.radius.md,
      paddingHorizontal: theme.space.md,
      paddingVertical: theme.space.sm,
    },
    // A fixed-width tap target either side, so the label stays centred between
    // them and does not shift by a pixel when an arrow dims.
    arrowTarget: {
      width: 32,
      alignItems: 'center',
      justifyContent: 'center',
    },
    previousArrow: {
      ...arrow,
      color: canGoPrevious ? theme.color.text.primary : theme.color.text.tertiary,
    },
    nextArrow: {
      ...arrow,
      color: canGoNext ? theme.color.text.primary : theme.color.text.tertiary,
    },
    label: {
      flex: 1,
      textAlign: 'center',
      color: theme.color.text.secondary,
      fontSize: theme.type.body.fontSize,
      lineHeight: theme.type.body.lineHeight,
      fontWeight: '600',
    },
  });
}

export default StatisticsRangeStepper;
