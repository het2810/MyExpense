import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../theme/useTheme';

/**
 * Small square checkbox — checked = filled `accent.primary` + `✓`,
 * unchecked = `border.subtle` outline. Promoted from `NewGroupScreen.jsx`'s
 * former local, unexported `Checkbox` (same visual spec, no visual change)
 * per docs/decisions/0005-split-add-expense-flow.md §2.4, once a third and
 * fourth call site (Adjust Split's per-person + "All" master checkboxes,
 * Split Add Expense's "Add this transaction to my expenses" field) crossed
 * constitution §25's "duplicate three times → extract reusable code"
 * threshold.
 *
 * Purely presentational — it renders the checked/unchecked visual state
 * only. Callers wire up tap handling themselves (e.g. `ListItem`'s
 * `onPress` for a row-tap-to-toggle checkbox, or a `Pressable` wrapper for
 * a standalone one like Adjust Split's "All" master checkbox) rather than
 * this component owning its own `onPress`, matching its original inline
 * usage in `NewGroupScreen.jsx`.
 * See docs/decisions/0001-shared-component-library.md.
 */
function Checkbox({ checked, style }) {
  const theme = useTheme();
  const styles = createStyles(theme, checked);

  return (
    <View style={[styles.box, style]}>
      {checked ? <Text style={styles.check}>✓</Text> : null}
    </View>
  );
}

function createStyles(theme, checked) {
  return StyleSheet.create({
    box: {
      width: 22,
      height: 22,
      borderRadius: theme.radius.sm,
      borderWidth: 1.5,
      borderColor: checked ? theme.color.accent.primary : theme.color.border.subtle,
      backgroundColor: checked ? theme.color.accent.primary : 'transparent',
      alignItems: 'center',
      justifyContent: 'center',
    },
    check: {
      color: theme.color.accent.onPrimary,
      fontSize: 14,
      fontWeight: '700',
    },
  });
}

export default Checkbox;
