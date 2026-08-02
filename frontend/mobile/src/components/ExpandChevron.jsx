import React from 'react';
import { Text, Pressable, StyleSheet } from 'react-native';
import { useTheme } from '../theme/useTheme';

/**
 * The expand/collapse affordance for an accordion row — a trailing chevron
 * that points down when open and right when closed.
 *
 * **Extracted rather than copied** (constitution §25). It was written inline in
 * CategoryPickerScreen's `ParentCategoryRow`; ManageCategoriesScreen is the
 * second surface that discloses a category's subcategories, and the two must
 * read as the same control — the Project Owner's requirement for the new
 * screen was explicitly that it "feel like one app" alongside the picker.
 *
 * The stronger reason is the glyph itself: this is a placeholder `Text`
 * character standing in for Ionicons `chevron-down-outline` /
 * `chevron-forward-outline` (docs/ui/design-system.md §6), the same
 * glyph-fallback convention ScreenHeader (←/✕) and MainTabs (₹/⇄/P) use while
 * react-native-vector-icons (docs/decisions/0002-icon-library-selection.md)
 * remains approved-but-unlinked. When the icon library is actually installed,
 * the swap has to happen in exactly one place, not in every accordion in the
 * app. **No new icon concept is introduced** — design-system.md §6 needs no
 * change.
 *
 * Always its own press target with its own accessibility label, because that
 * is what the picker needs: there the row body *selects* the category and only
 * this chevron expands it, so the two intents never tax each other. Manage
 * Categories has no competing intent and lets the whole row toggle as well,
 * which is harmless — both targets perform the same action, and a screen
 * reader still gets a labelled control.
 *
 * The label is supplied by the caller rather than composed here, so this stays
 * a plain layout primitive with no knowledge of categories (the same reason
 * ScreenHeader takes a `rightSlot` instead of knowing about Avatar).
 *
 * @param {{
 *   isExpanded: boolean,
 *   onPress: () => void,
 *   accessibilityLabel: string,
 * }} props
 */
function ExpandChevron({ isExpanded, onPress, accessibilityLabel }) {
  const theme = useTheme();
  const styles = createStyles(theme);

  return (
    <Pressable
      onPress={onPress}
      hitSlop={theme.space.md}
      accessibilityRole="button"
      accessibilityState={{ expanded: isExpanded }}
      accessibilityLabel={accessibilityLabel}
    >
      <Text style={styles.chevron}>{isExpanded ? '▾' : '▸'}</Text>
    </Pressable>
  );
}

function createStyles(theme) {
  return StyleSheet.create({
    chevron: {
      color: theme.color.text.tertiary,
      fontSize: 18,
      paddingHorizontal: theme.space.xs,
    },
  });
}

export default ExpandChevron;
