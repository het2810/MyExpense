import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../theme/useTheme';

/**
 * The read-only "who is in this expense" block Split Add Expense shows in
 * edit mode — docs/decisions/0028-split-expense-edit-delete-feeds-and-balance-copy.md
 * §2.2/§11.5: the Individual/Group choice, the group and the contacts are
 * immutable after creation, so they render as text with the caption that
 * says how to change them.
 *
 * @param {{ modeLabel: string, targetLabel: string, targetText: string }} props
 */
function SplitEditLockedTarget({ modeLabel, targetLabel, targetText }) {
  const theme = useTheme();
  const styles = createStyles(theme);
  return (
    <View style={styles.container}>
      <Text style={styles.label}>INDIVIDUAL/GROUP</Text>
      <Text style={styles.value}>{modeLabel}</Text>
      <Text style={[styles.label, styles.spaced]}>{targetLabel}</Text>
      <Text style={styles.value}>{targetText}</Text>
      <Text style={styles.caption}>
        To change who&apos;s in this expense, delete it and add it again.
      </Text>
    </View>
  );
}

function createStyles(theme) {
  return StyleSheet.create({
    container: {
      marginTop: theme.space.md,
      marginBottom: theme.space.lg,
    },
    label: {
      color: theme.color.text.tertiary,
      fontSize: theme.type.label.fontSize,
      lineHeight: theme.type.label.lineHeight,
      fontWeight: theme.type.label.fontWeight,
      textTransform: theme.type.label.textTransform,
      letterSpacing: theme.type.label.letterSpacing,
      marginBottom: theme.space.xs,
    },
    spaced: {
      marginTop: theme.space.md,
    },
    value: {
      color: theme.color.text.secondary,
      fontSize: theme.type.bodyLg.fontSize,
    },
    caption: {
      color: theme.color.text.tertiary,
      fontSize: theme.type.caption.fontSize,
      marginTop: theme.space.sm,
    },
  });
}

export default SplitEditLockedTarget;
