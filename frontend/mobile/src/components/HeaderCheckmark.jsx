import React from 'react';
import { Text, Pressable, StyleSheet } from 'react-native';
import { useTheme } from '../theme/useTheme';

/**
 * The header "Save" checkmark, composed into ScreenHeader's `rightSlot` —
 * mirroring how ThemeToggleButton + Avatar are composed there on other screens
 * (docs/decisions/0005-split-add-expense-flow.md §3.1).
 *
 * Promoted from two file-local copies (SplitAddExpenseScreen, AdjustSplitScreen)
 * when "Who paid?" (docs/decisions/0025-multiple-payers-per-split-expense.md
 * §8.4) became the third screen to need it — constitution §25's
 * "duplicate three times → extract".
 *
 * `disabled` dims the glyph and ignores presses: an in-flight save, or a form
 * whose confirm rule is not met yet.
 */
function HeaderCheckmark({ onPress, disabled = false }) {
  const theme = useTheme();
  const styles = createStyles(theme);

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel="Save"
      accessibilityState={{ disabled }}
    >
      {/* Placeholder Text glyph standing in for Ionicons `checkmark-outline`
          (design-system.md §6/§9) — the real icon library isn't
          installed/linked in this codebase yet, matching the same
          glyph-fallback convention already used by ScreenHeader (←/✕) and
          AddExpenseScreen's date field. */}
      <Text style={[styles.icon, disabled && styles.iconDisabled]}>✓</Text>
    </Pressable>
  );
}

function createStyles(theme) {
  return StyleSheet.create({
    icon: {
      color: theme.color.text.primary,
      fontSize: 22,
      fontWeight: '700',
    },
    // The same 0.5 opacity PrimaryButton's own `disabled` state uses, so a
    // disabled confirm reads the same way wherever it happens.
    iconDisabled: {
      opacity: 0.5,
    },
  });
}

export default HeaderCheckmark;
