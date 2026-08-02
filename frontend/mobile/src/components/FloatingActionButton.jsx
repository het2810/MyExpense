import React from 'react';
import { Pressable, Text, View, StyleSheet } from 'react-native';
import { useTheme } from '../theme/useTheme';

/**
 * Circular "+" button, bottom-right, with a soft cyan glow — used to open
 * Add Expense / New Group. See docs/decisions/0001-shared-component-library.md.
 */
function FloatingActionButton({ onPress, glyph = '+', style }) {
  const theme = useTheme();
  const styles = createStyles(theme);

  return (
    <View style={[styles.glowWrapper, style]}>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        style={({ pressed }) => [styles.fab, pressed && styles.pressed]}
      >
        <Text style={styles.glyph}>{glyph}</Text>
      </Pressable>
    </View>
  );
}

function createStyles(theme) {
  return StyleSheet.create({
    glowWrapper: {
      position: 'absolute',
      right: theme.space.xl,
      bottom: theme.space.xl,
      shadowColor: theme.color.overlay.glow,
      shadowOpacity: 1,
      shadowRadius: 20,
      shadowOffset: { width: 0, height: 0 },
      elevation: 6,
      borderRadius: theme.radius.circle,
    },
    fab: {
      width: 56,
      height: 56,
      borderRadius: theme.radius.circle,
      backgroundColor: theme.color.accent.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    pressed: {
      opacity: 0.85,
    },
    glyph: {
      color: theme.color.accent.onPrimary,
      fontSize: 28,
      fontWeight: '700',
      lineHeight: 30,
    },
  });
}

export default FloatingActionButton;
