import React from 'react';
import { Pressable, Text, View, StyleSheet, ActivityIndicator } from 'react-native';
import { useTheme } from '../theme/useTheme';

/**
 * Pill-shaped primary call-to-action button — accent.primary fill, optional
 * glow, type.button label in accent.onPrimary. Used for "Save Expense",
 * "Create Group", "Sign In", "Sign Up", etc.
 * See docs/decisions/0001-shared-component-library.md.
 *
 * `icon` (optional, added docs/decisions/0009-split-detail-and-settle-up.md
 * §8) — a pre-rendered node, rendered to the left of `label` inside the
 * existing pill. Mirrors the "accept a pre-rendered node for a slot"
 * convention already used elsewhere (ListItem's leading/trailing,
 * ScreenHeader's rightSlot). Purely additive — every existing call site
 * omits it and is completely unaffected.
 *
 * `tone` (optional, `'default' | 'negative'`, added docs/decisions/
 * 0013-confirmation-dialog-and-free-tier-polish.md §2) — purely additive,
 * default `'default'`, zero behavior change for every existing call site
 * (same precedent as `icon` above). `'negative'` fills the button with
 * `status.negative` and labels it in `status.onNegative` instead of the
 * accent pair, for destructive confirmations (e.g. ConfirmationDialog's
 * "Delete"). Glow is forced off when `tone="negative"`, regardless of the
 * `glow` prop — this app's cyan glow is a brand/positive-affirmation
 * signature (design-system.md §1.5), not appropriate for a destructive
 * action.
 */
function PrimaryButton({
  label,
  onPress,
  icon,
  glow = true,
  tone = 'default',
  disabled = false,
  loading = false,
  style,
}) {
  const theme = useTheme();
  const isDisabled = disabled || loading;
  const isNegative = tone === 'negative';
  const showGlow = glow && !isNegative;
  const styles = createStyles(theme, showGlow, isDisabled, isNegative);

  return (
    <View style={showGlow && !isDisabled ? styles.glowWrapper : null}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: isDisabled }}
        onPress={isDisabled ? undefined : onPress}
        style={({ pressed }) => [
          styles.button,
          pressed && !isDisabled ? styles.pressed : null,
          style,
        ]}
      >
        {loading ? (
          <ActivityIndicator
            color={isNegative ? theme.color.status.onNegative : theme.color.accent.onPrimary}
          />
        ) : (
          <View style={styles.content}>
            {icon ? <View style={styles.iconSlot}>{icon}</View> : null}
            <Text style={styles.label} numberOfLines={1}>
              {label}
            </Text>
          </View>
        )}
      </Pressable>
    </View>
  );
}

function createStyles(theme, glow, isDisabled, isNegative) {
  return StyleSheet.create({
    glowWrapper: {
      shadowColor: theme.color.overlay.glow,
      shadowOpacity: 1,
      shadowRadius: 20,
      shadowOffset: { width: 0, height: 0 },
      elevation: 6,
      borderRadius: theme.radius.pill,
    },
    button: {
      backgroundColor: isNegative ? theme.color.status.negative : theme.color.accent.primary,
      borderRadius: theme.radius.pill,
      paddingVertical: theme.space.md,
      paddingHorizontal: theme.space.xxl,
      alignItems: 'center',
      justifyContent: 'center',
      opacity: isDisabled ? 0.5 : 1,
    },
    pressed: {
      opacity: 0.85,
    },
    content: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
    },
    iconSlot: {
      marginRight: theme.space.sm,
    },
    label: {
      color: isNegative ? theme.color.status.onNegative : theme.color.accent.onPrimary,
      fontSize: theme.type.button.fontSize,
      lineHeight: theme.type.button.lineHeight,
      fontWeight: theme.type.button.fontWeight,
    },
  });
}

export default PrimaryButton;
