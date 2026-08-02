import React from 'react';
import { Pressable, Text, View, StyleSheet, ActivityIndicator } from 'react-native';
import { useTheme } from '../theme/useTheme';

/**
 * Pill-shaped primary call-to-action button — accent.primary fill, optional
 * glow, type.button label in accent.onPrimary. Used for "Save Expense",
 * "Create Group", "Sign In", "Sign Up", etc.
 * See docs/decisions/0001-shared-component-library.md.
 */
function PrimaryButton({
  label,
  onPress,
  glow = true,
  disabled = false,
  loading = false,
  style,
}) {
  const theme = useTheme();
  const isDisabled = disabled || loading;
  const styles = createStyles(theme, glow, isDisabled);

  return (
    <View style={glow && !isDisabled ? styles.glowWrapper : null}>
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
          <ActivityIndicator color={theme.color.accent.onPrimary} />
        ) : (
          <Text style={styles.label} numberOfLines={1}>
            {label}
          </Text>
        )}
      </Pressable>
    </View>
  );
}

function createStyles(theme, glow, isDisabled) {
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
      backgroundColor: theme.color.accent.primary,
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
    label: {
      color: theme.color.accent.onPrimary,
      fontSize: theme.type.button.fontSize,
      lineHeight: theme.type.button.lineHeight,
      fontWeight: theme.type.button.fontWeight,
    },
  });
}

export default PrimaryButton;
