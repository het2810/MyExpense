import React from 'react';
import { View, StyleSheet } from 'react-native';
import { useTheme } from '../theme/useTheme';

/**
 * Base surface container — radius.lg, background.surface, subtle border.
 * The primitive nearly every other composed screen section builds on top of.
 * See docs/decisions/0001-shared-component-library.md.
 */
function Card({ children, style, ...rest }) {
  const theme = useTheme();
  const styles = createStyles(theme);

  return (
    <View style={[styles.card, style]} {...rest}>
      {children}
    </View>
  );
}

function createStyles(theme) {
  return StyleSheet.create({
    card: {
      backgroundColor: theme.color.background.surface,
      borderRadius: theme.radius.lg,
      borderWidth: 1,
      borderColor: theme.color.border.subtle,
      padding: theme.space.lg,
    },
  });
}

export default Card;
