import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useTheme } from '../theme/useTheme';

/**
 * Settle Up's "Suggested payments" — docs/decisions/
 * 0028-split-expense-edit-delete-feeds-and-balance-copy.md §8.3/§9.2: one row
 * per viewer debt (`debtSentence`) with a **Pay** or **Record** button that
 * prefills the form. Renders nothing when there are none.
 *
 * @param {{ suggestions: Array<{ key: string, label: string, actionLabel: string }>,
 *   selectedKey: string | null, onSelect: (suggestion: object) => void }} props
 */
function SettleSuggestions({ suggestions, selectedKey, onSelect }) {
  const theme = useTheme();
  const styles = createStyles(theme);
  if (suggestions.length === 0) {
    return null;
  }
  return (
    <View style={styles.container}>
      <Text style={styles.label}>SUGGESTED PAYMENTS</Text>
      {suggestions.map((suggestion) => (
        <View key={suggestion.key} style={styles.row}>
          <Text style={styles.sentence}>{suggestion.label}</Text>
          <Pressable
            onPress={() => onSelect(suggestion)}
            accessibilityRole="button"
            accessibilityState={{ selected: selectedKey === suggestion.key }}
            style={[styles.button, selectedKey === suggestion.key && styles.buttonSelected]}
          >
            <Text style={[styles.buttonText, selectedKey === suggestion.key && styles.buttonTextSelected]}>
              {suggestion.actionLabel}
            </Text>
          </Pressable>
        </View>
      ))}
    </View>
  );
}

function createStyles(theme) {
  return StyleSheet.create({
    container: {
      marginBottom: theme.space.lg,
    },
    label: {
      color: theme.color.text.tertiary,
      fontSize: theme.type.label.fontSize,
      fontWeight: theme.type.label.fontWeight,
      textTransform: theme.type.label.textTransform,
      letterSpacing: theme.type.label.letterSpacing,
      marginBottom: theme.space.sm,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: theme.space.sm,
      borderBottomWidth: 1,
      borderBottomColor: theme.color.border.subtle,
    },
    sentence: {
      flex: 1,
      color: theme.color.text.primary,
      fontSize: theme.type.body.fontSize,
      lineHeight: theme.type.body.lineHeight,
      marginRight: theme.space.md,
    },
    button: {
      borderRadius: theme.radius.pill,
      borderWidth: 1,
      borderColor: theme.color.accent.primary,
      paddingHorizontal: theme.space.md,
      paddingVertical: theme.space.xs,
    },
    buttonSelected: {
      backgroundColor: theme.color.accent.primary,
    },
    buttonText: {
      color: theme.color.accent.primary,
      fontSize: theme.type.body.fontSize,
      fontWeight: '600',
    },
    buttonTextSelected: {
      color: theme.color.accent.onPrimary,
    },
  });
}

export default SettleSuggestions;
