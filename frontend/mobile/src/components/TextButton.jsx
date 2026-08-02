import React from 'react';
import { Pressable, Text, StyleSheet } from 'react-native';
import { useTheme } from '../theme/useTheme';

/**
 * Text-only secondary action — "CANCEL", "Forgot password?", "Sign Up" /
 * "Sign In" cross-links. Distinct from PrimaryButton: lighter tap target,
 * no fill. See docs/decisions/0001-shared-component-library.md.
 */
function TextButton({ label, onPress, align = 'left', inline = false, tone = 'accent', style }) {
  const theme = useTheme();
  const styles = createStyles(theme, align, inline, tone);

  return (
    <Pressable onPress={onPress} hitSlop={8} style={[styles.wrapper, style]}>
      <Text style={styles.label}>{label}</Text>
    </Pressable>
  );
}

function createStyles(theme, align, inline, tone) {
  const color =
    tone === 'negative' ? theme.color.status.negative : theme.color.accent.text;

  return StyleSheet.create({
    wrapper: {
      alignSelf: inline ? 'auto' : align === 'right' ? 'flex-end' : 'flex-start',
    },
    label: {
      color,
      fontSize: theme.type.body.fontSize,
      lineHeight: theme.type.body.lineHeight,
      fontWeight: '600',
    },
  });
}

export default TextButton;
