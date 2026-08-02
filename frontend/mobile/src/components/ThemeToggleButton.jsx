import React from 'react';
import { Pressable, Text, StyleSheet } from 'react-native';
import { useTheme } from '../theme/useTheme';
import { useThemeStore } from '../store/useThemeStore';

/**
 * Sun/moon header icon button that toggles useThemeStore. Required on every
 * main (authenticated) app screen, immediately left of the profile avatar —
 * must NOT appear on Splash / Sign In / Sign Up / Forgot Password.
 * See docs/ui/design-system.md Section 5 and
 * docs/decisions/0001-shared-component-library.md.
 *
 * Uses plain Unicode symbols (☀ / ☾) rather than an icon font or emoji —
 * no icon library dependency is installed yet (see handoff notes).
 */
function ThemeToggleButton({ style }) {
  const theme = useTheme();
  const toggleTheme = useThemeStore((state) => state.toggleTheme);
  const styles = createStyles(theme);

  return (
    <Pressable
      onPress={toggleTheme}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel="Toggle light and dark theme"
      style={[styles.button, style]}
    >
      <Text style={styles.glyph}>{theme.mode === 'dark' ? '☾' : '☀'}</Text>
    </Pressable>
  );
}

function createStyles(theme) {
  return StyleSheet.create({
    button: {
      width: 36,
      height: 36,
      borderRadius: theme.radius.circle,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.color.background.surfaceAlt,
    },
    glyph: {
      color: theme.color.accent.text,
      fontSize: 18,
    },
  });
}

export default ThemeToggleButton;
