import React from 'react';
import { View, TextInput as RNTextInput, Text, StyleSheet } from 'react-native';
import { useTheme } from '../theme/useTheme';

/**
 * Boxed pill search field with a leading icon glyph — used on All Expenses,
 * New Group member search, Category Picker. Visually distinct from the
 * underline TextInput (boxed background.surfaceAlt pill vs. underline).
 * See docs/decisions/0001-shared-component-library.md.
 *
 * Not yet consumed by any screen built in this phase (All Expenses, New
 * Group, and Category Picker are future work) — built now per the ADR's
 * required base-component set.
 */
function SearchBar({ value, onChangeText, placeholder = 'Search', style }) {
  const theme = useTheme();
  const styles = createStyles(theme);

  return (
    <View style={[styles.container, style]}>
      <Text style={styles.icon}>⌕</Text>
      <RNTextInput
        style={styles.input}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.color.text.tertiary}
      />
    </View>
  );
}

function createStyles(theme) {
  return StyleSheet.create({
    container: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: theme.color.background.surfaceAlt,
      borderRadius: theme.radius.md,
      paddingHorizontal: theme.space.lg,
      paddingVertical: theme.space.sm,
    },
    icon: {
      color: theme.color.text.tertiary,
      fontSize: theme.type.bodyLg.fontSize,
      marginRight: theme.space.sm,
    },
    input: {
      flex: 1,
      color: theme.color.text.primary,
      fontSize: theme.type.body.fontSize,
      paddingVertical: 0,
    },
  });
}

export default SearchBar;
