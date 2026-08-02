import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, Text, View, StyleSheet } from 'react-native';
import { useTheme } from '../theme/useTheme';
import { FAB_COLLAPSED_SIZE, getFabBottomOffset } from '../theme/layout';

// Collapsed diameter — unchanged from the original circular "+" button.
// Sourced from theme/layout.js, which is also what MainTabs.jsx and any
// screen's clearing-padding math read, so this can never silently drift
// out of sync with what those consumers assume.
const COLLAPSED_SIZE = FAB_COLLAPSED_SIZE;

// Width of the expanded "Add Expense" pill. There's no icon library wired
// into IconBadge/this component yet (see
// docs/decisions/0002-icon-library-selection.md), so the expanded state is
// text-only — sized to comfortably fit the `label` at the button/700, 16px
// text style plus generous horizontal padding. If a longer label is ever
// passed in, this constant should be revisited.
const EXPANDED_WIDTH = 172;

// Duration (ms) of the expand/collapse transition in both directions.
const TRANSITION_DURATION = 75;

/**
 * Bottom-right floating action button, anchored above the tab bar.
 *
 * Renders as a circular "+" icon button by default. When `label` is
 * provided, it becomes an expand/collapse pill: `expanded={true}` shows a
 * cyan pill with `label` (no icon, matching this codebase's current
 * no-icon-library state); `expanded={false}` animates it down to the same
 * circular icon-only button used before `label`/`expanded` existed. The
 * width/opacity transition is driven by RN's built-in `Animated` API (not
 * `LayoutAnimation`) because it needs precise, independently-timed
 * choreography — width shrinking while the glyph/label cross-fade without
 * ever overlapping legibly — which `LayoutAnimation`'s single global,
 * next-frame layout diff can't guarantee.
 *
 * The Pressable fills the animated container (`flex: 1`) rather than being
 * sized independently, so the tap target always matches the button's
 * current visual bounds and stays tappable at every point of the
 * transition, collapsed or expanded or mid-animation.
 *
 * See docs/decisions/0001-shared-component-library.md.
 */
function FloatingActionButton({ onPress, glyph = '+', label, expanded = true, style }) {
  const theme = useTheme();
  const styles = createStyles(theme);

  // 0 = fully collapsed (circle), 1 = fully expanded (pill). Only animates
  // between the two states when a `label` is actually supplied — plain
  // icon-only usage (no `label`) stays a static circle.
  const animation = useRef(new Animated.Value(label && expanded ? 1 : 0)).current;

  useEffect(() => {
    if (!label) {
      return;
    }
    Animated.timing(animation, {
      toValue: expanded ? 1 : 0,
      duration: TRANSITION_DURATION,
      easing: Easing.inOut(Easing.ease),
      // `width` isn't supported by the native driver, so this whole
      // animated value (which also drives the glyph/label opacity
      // interpolations below) has to stay JS-driven.
      useNativeDriver: false,
    }).start();
  }, [expanded, label, animation]);

  const width = label
    ? animation.interpolate({
        inputRange: [0, 1],
        outputRange: [COLLAPSED_SIZE, EXPANDED_WIDTH],
      })
    : COLLAPSED_SIZE;

  // The glyph fades out over the first ~40% of the expand animation, and
  // the label only fades in over the last ~40% — leaving a brief window
  // around the midpoint where neither is visible while the pill is still
  // resizing, so the two never visibly overlap. Symmetric on collapse.
  // These breakpoints are fractions of normalized progress (0-1), not
  // absolute time, so "glyph reaches 0 opacity by 0.4 / label starts
  // rising only at 0.6" holds regardless of TRANSITION_DURATION — a faster
  // duration shortens the dead zone between them proportionally but can
  // never reintroduce overlap.
  const glyphOpacity = animation.interpolate({
    inputRange: [0, 0.4, 1],
    outputRange: [1, 0, 0],
  });
  const labelOpacity = animation.interpolate({
    inputRange: [0, 0.6, 1],
    outputRange: [0, 0, 1],
  });

  return (
    <View style={[styles.glowWrapper, style]}>
      <Animated.View style={[styles.fab, { width }]}>
        <Pressable
          onPress={onPress}
          accessibilityRole="button"
          accessibilityLabel={label || 'Add'}
          style={({ pressed }) => [styles.pressable, pressed && styles.pressed]}
        >
          <Animated.View style={[styles.contentLayer, { opacity: glyphOpacity }]}>
            <Text style={styles.glyph}>{glyph}</Text>
          </Animated.View>
          {label ? (
            <Animated.View style={[styles.contentLayer, { opacity: labelOpacity }]}>
              <Text style={styles.label} numberOfLines={1}>
                {label}
              </Text>
            </Animated.View>
          ) : null}
        </Pressable>
      </Animated.View>
    </View>
  );
}

function createStyles(theme) {
  return StyleSheet.create({
    glowWrapper: {
      position: 'absolute',
      right: theme.space.xl,
      // The bottom tab bar (see MainTabs.jsx) floats at `bottom: theme.space.lg`
      // with `height: 64`, so its top edge sits `theme.space.lg + 64` = 80px
      // above the screen bottom and is fully opaque. The FAB must clear that
      // edge with a visible gap, not just avoid overlapping it, otherwise it
      // renders hidden underneath the tab bar. `theme.space.xxxl * 3` = 96px
      // leaves a `theme.space.lg` (16px) gap above the tab bar's top edge.
      // Sourced from theme/layout.js (getFabBottomOffset) — screens compute
      // their clearing padding from the same export, so this must stay the
      // actual position, not a duplicated literal.
      bottom: getFabBottomOffset(theme),
      shadowColor: theme.color.overlay.glow,
      shadowOpacity: 1,
      shadowRadius: 20,
      shadowOffset: { width: 0, height: 0 },
      elevation: 6,
      borderRadius: theme.radius.circle,
    },
    fab: {
      height: COLLAPSED_SIZE,
      // `theme.radius.circle` is deliberately far larger than half of
      // either dimension — React Native (like CSS) clamps a corner radius
      // to half the element's size, so this single constant renders a full
      // circle when width === height (collapsed) and a fully-rounded
      // "stadium" pill once width animates wider (expanded), with no need
      // to animate borderRadius separately.
      borderRadius: theme.radius.circle,
      backgroundColor: theme.color.accent.primary,
      overflow: 'hidden',
    },
    pressable: {
      flex: 1,
    },
    pressed: {
      opacity: 0.85,
    },
    contentLayer: {
      ...StyleSheet.absoluteFillObject,
      alignItems: 'center',
      justifyContent: 'center',
    },
    glyph: {
      color: theme.color.accent.onPrimary,
      fontSize: 28,
      fontWeight: '700',
      // `contentLayer` already centers this Text via absolute-fill +
      // alignItems/justifyContent: 'center', so the container itself is
      // correctly centered. The remaining offset is Android's font-metrics
      // padding (`includeFontPadding` defaults to true), which reserves
      // extra, asymmetric space above/below the glyph's actual ink — making
      // it look vertically off-center inside a perfectly-centered box.
      // `includeFontPadding: false` removes that reserved space and
      // `textAlignVertical: 'center'` centers the glyph within whatever box
      // remains; both are no-ops on iOS, which doesn't have this issue.
      // An earlier explicit `lineHeight: 30` here was a partial, box-level
      // workaround for the same font-padding problem and was dropped once
      // `includeFontPadding`/`textAlignVertical` above became the real fix.
      // A small `lineHeight` is reintroduced below, but for an unrelated,
      // finer-grained reason — see that comment.
      includeFontPadding: false,
      textAlignVertical: 'center',
      // Box-centering (above) is correct, but the "+" glyph's own ink isn't
      // perfectly centered within its default line box — its crossbar/visual
      // weight sits slightly high, so it still reads as a hair off-center
      // inside an otherwise perfectly-centered circle. A `lineHeight` a
      // touch taller than `fontSize` gives the text renderer a bit of extra,
      // evenly-distributed room to center the glyph's ink within on both
      // platforms, working together with `textAlignVertical: 'center'`
      // above — more portable than a raw `translateY`/`marginTop` pixel
      // offset, which is a fixed value that wouldn't scale if `fontSize`
      // ever changes and can render differently across iOS/Android's
      // differing "+" glyph metrics. Kept deliberately small (2px over the
      // 28px fontSize) since this is a fine visual nudge, not a structural
      // fix.
      lineHeight: 55,
    },
    label: {
      color: theme.color.accent.onPrimary,
      fontSize: theme.type.button.fontSize,
      fontWeight: theme.type.button.fontWeight,
      paddingHorizontal: theme.space.lg,
      // Same Android font-padding fix as `glyph`, applied for the same
      // reason — `paddingHorizontal` here is symmetric (left/right), so it
      // was never the source of any horizontal offset; this only affects
      // vertical centering.
      includeFontPadding: false,
      textAlignVertical: 'center',
    },
  });
}

export default FloatingActionButton;
