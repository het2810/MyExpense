import React from 'react';
import { Text, Pressable, StyleSheet } from 'react-native';
import { useTheme } from '../theme/useTheme';

/**
 * Shared header delete control (Transaction Detail, Dashboard multi-select) —
 * composed into ScreenHeader's rightSlot (ADR 0007's
 * 2026-08-13 amendment, Part B). A plain icon, no circular tint container —
 * matching every other header rightSlot icon's bare layout (the split/
 * adjust-split header checkmark, AdjustSplitScreen's pencil) — but keeping
 * color.status.negative since this remains a genuinely destructive action,
 * unlike those neutral header icons. hitSlop={8} matches ScreenHeader's own
 * onBack/onClose convention exactly.
 */
function HeaderDeleteButton({
  onPress,
  accessibilityLabel = 'Delete',
  disabled = false,
}) {
  const theme = useTheme();
  const styles = createHeaderDeleteButtonStyles(theme);

  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      disabled={disabled}
    >
      {/* Placeholder Text glyph standing in for Ionicons `trash-outline`
          (design-system.md §6/§11) — the real icon library isn't
          installed/linked in this codebase yet, matching the same
          glyph-fallback convention already used throughout this app
          (ScreenHeader's ←/✕, AddExpenseScreen's ▦, etc). Swap for a real
          <Icon> once the library is wired in.
          Corrected 2026-08-14 (docs/decisions/
          0013-confirmation-dialog-and-free-tier-polish.md §1.1): the
          previous glyph, ⌧ (U+232B), read as an "X" and risked colliding
          with ScreenHeader's own close/X (✕) concept — reported by the
          Project Owner. 🗑 (U+1F5D1, WASTEBASKET) is the only glyph in this
          app's fallback vocabulary that actually depicts a trash can.
          Flagged risk: unlike every other glyph here (←, ✕, ✓, ⇄, ✎), 🗑
          sits in an emoji-heavy Unicode block and may render in full color
          on some platform/font combinations, ignoring the `color` style
          below. Visually verify on-device; if it renders off-tone, the
          ADR's suggested fallback is a plain abstract non-X symbol (▥) —
          worse at depicting "trash" but still not misleading. */}
      <Text style={styles.icon}>🗑</Text>
    </Pressable>
  );
}

function createHeaderDeleteButtonStyles(theme) {
  return StyleSheet.create({
    icon: {
      color: theme.color.status.negative,
      fontSize: 20,
      fontWeight: '700',
    },
  });
}

export default HeaderDeleteButton;
