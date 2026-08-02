import React from 'react';
import { View, Text, TextInput as RNTextInput, StyleSheet } from 'react-native';
import { useTheme } from '../theme/useTheme';

/**
 * Compact underline numeric field for a ListItem's trailing slot — Adjust
 * Split's per-row input (Unequally / By percentages / By shares / By
 * adjustment) and "Who paid?"'s per-person amount.
 *
 * Promoted from AdjustSplitScreen.jsx, where it was file-local, so "Who paid?"
 * (docs/decisions/0025-multiple-payers-per-split-expense.md §8.4) uses the same
 * field rather than a copy — the ADR leaves that call to the Frontend Engineer.
 * Unchanged in behaviour and styling.
 */
function InlineNumberField({ prefix, suffix, value, onChangeText, placeholder, keyboardType }) {
  const theme = useTheme();
  const styles = createStyles(theme);

  return (
    <View style={styles.row}>
      {prefix ? <Text style={styles.affix}>{prefix}</Text> : null}
      <RNTextInput
        style={styles.input}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.color.text.tertiary}
        keyboardType={keyboardType ?? 'decimal-pad'}
      />
      {suffix ? <Text style={styles.affix}>{suffix}</Text> : null}
    </View>
  );
}

function createStyles(theme) {
  return StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      borderBottomWidth: 1,
      borderBottomColor: theme.color.border.subtle,
      paddingBottom: theme.space.xs,
      minWidth: 88,
    },
    affix: {
      color: theme.color.text.tertiary,
      fontSize: theme.type.body.fontSize,
      marginHorizontal: theme.space.xs,
    },
    input: {
      flex: 1,
      textAlign: 'right',
      color: theme.color.text.primary,
      fontSize: theme.type.bodyLg.fontSize,
      paddingVertical: 0,
    },
  });
}

export default InlineNumberField;
