import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/useTheme';

/**
 * Shared screen header — title + optional back/close icon + optional
 * right-hand icon cluster (e.g. [theme toggle][avatar]).
 * Appears on every screen except Splash and Sign In (design-system.md
 * Section 4.1). Consumers compose the right cluster via `rightSlot` so this
 * component stays a plain layout primitive, not a place that knows about
 * ThemeToggleButton/Avatar directly.
 *
 * `align` controls title placement: 'center' (default, unchanged behavior —
 * symmetric left/right slots) or 'left' (title sits flush at the leading
 * edge, e.g. Dashboard's "MyExpense" wordmark).
 * See docs/decisions/0001-shared-component-library.md.
 *
 * SAFE AREA (top): every navigator in this app runs with
 * `headerShown: false` (AuthStack/MyExpenseStack/SplitStack/ProfileStack and
 * the root stack), so this component IS the topmost thing on screen on every
 * route that renders it — nothing above it reserves the status bar. It
 * therefore owns the top inset itself: the status-bar/notch/Dynamic-Island
 * height is added to the designed `theme.space.lg` top padding, so the title
 * row always begins below the system bar instead of colliding with the
 * clock/wifi/battery icons.
 *
 * Applying it here rather than in each screen keeps it impossible to miss a
 * screen, and impossible to double-apply: no screen adds an inset of its own
 * above this header, and the one route that DOES have a native header
 * (CategoryPicker, `headerShown: true`) does not render a ScreenHeader at
 * all — the native header handles its own inset there.
 *
 * On a device with no status bar overlay `insets.top` is 0 and the header
 * renders exactly as designed.
 */
function ScreenHeader({
  title,
  onBack,
  onClose,
  rightSlot,
  align = 'center',
  style,
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const hasLeftIcon = Boolean(onBack || onClose);
  const styles = createStyles(theme, align, hasLeftIcon, insets);

  return (
    <View style={[styles.header, style]}>
      <View style={styles.leftSlot}>
        {onBack ? (
          <Pressable onPress={onBack} hitSlop={8} accessibilityLabel="Go back">
            <Text style={styles.icon}>←</Text>
          </Pressable>
        ) : onClose ? (
          <Pressable onPress={onClose} hitSlop={8} accessibilityLabel="Close">
            <Text style={styles.icon}>✕</Text>
          </Pressable>
        ) : null}
      </View>

      {title ? (
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
      ) : (
        <View style={styles.titlePlaceholder} />
      )}

      <View style={styles.rightSlot}>{rightSlot}</View>
    </View>
  );
}

function createStyles(theme, align, hasLeftIcon, insets) {
  // Centered headers reserve a fixed 32px left slot so the title stays
  // visually centered regardless of rightSlot content (symmetric with
  // rightSlot's minWidth: 32). Left-aligned headers only reserve that space
  // when an icon is actually present, so the title sits flush at the edge.
  const leftSlotWidth = align === 'left' ? (hasLeftIcon ? 32 : 0) : 32;

  return StyleSheet.create({
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: theme.space.xl,
      // The former single `paddingVertical: theme.space.lg` is split in two
      // so the status-bar inset can be added to the top edge only. The
      // designed 16px of breathing room above the title is preserved — the
      // inset is stacked on top of it, not substituted for it — so the
      // header reads identically on a device with no status bar overlay
      // (`insets.top === 0`) and simply starts lower where there is one.
      paddingTop: theme.space.lg + (insets?.top ?? 0),
      paddingBottom: theme.space.lg,
    },
    leftSlot: {
      width: leftSlotWidth,
      marginRight: align === 'left' && hasLeftIcon ? theme.space.sm : 0,
      alignItems: 'flex-start',
    },
    rightSlot: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.space.sm,
      minWidth: 32,
      justifyContent: 'flex-end',
    },
    title: {
      flex: 1,
      textAlign: align === 'left' ? 'left' : 'center',
      color: theme.color.text.primary,
      fontSize: theme.type.h1.fontSize,
      lineHeight: theme.type.h1.lineHeight,
      fontWeight: theme.type.h1.fontWeight,
    },
    titlePlaceholder: {
      flex: 1,
    },
    icon: {
      color: theme.color.text.primary,
      fontSize: 22,
    },
  });
}

export default ScreenHeader;
