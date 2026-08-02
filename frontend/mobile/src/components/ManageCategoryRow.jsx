import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useTheme } from '../theme/useTheme';
import ListItem from './ListItem';
import IconBadge from './IconBadge';
import ExpandChevron from './ExpandChevron';
import CategoryEditForm from './CategoryEditForm';

/**
 * One category row on Manage Categories, at either level: the row, its Edit
 * and Delete affordances, its inline edit form while it is open, and — for a
 * top-level row with children while the Subcategories preference is on — the
 * accordion that discloses them.
 *
 * **Extracted from ManageCategoriesScreen rather than written there**
 * (constitution §26, and that screen's own header note said it was already near
 * the component guideline before this round added two affordances). The row
 * markup itself is **unchanged** from the two functions that lived in the
 * screen: same `ExpandChevron`, same `▾`/`▸`, same subcategory-count subtitle,
 * same one-open-at-a-time accordion, same indented child block, and children
 * still render their own bare name rather than a composed `Food › Snacks` path
 * because the parent is the row directly above. Every surface *outside* a
 * nesting (the picker's search results, Add Expense, Dashboard, Transaction
 * Detail) still renders the full path through `formatCategoryPath`.
 *
 * Two behaviours carried over deliberately, both previously commented in the
 * screen:
 *
 * - **The whole row toggles**, not just the chevron. In Category Picker the
 *   row body *selects* the category and only the chevron expands it, because
 *   selecting a parent must never cost an extra tap. Nothing competes for the
 *   tap here, so the row itself expands — the Project Owner's requirement for
 *   this screen. The chevron stays a press target of its own so a screen
 *   reader still gets a labelled, expand-stateful control.
 * - **A childless category gets no arrow and no expand target.** The picker
 *   keeps its chevron on a childless parent because expanding is the only way
 *   to reach its "Add subcategory" form; this screen has no such form, so an
 *   arrow onto an empty box would be a dead affordance.
 *
 * ---
 * **THE PROTECTED ROW GETS NO DELETE AFFORDANCE AT ALL.**
 *
 * Not a disabled one, not one that explains itself on tap — nothing is
 * rendered (api-overview.md §3.1/§3.4,
 * docs/decisions/0021-category-rename-propagates-and-misc-reassignment-on-delete.md
 * §2.1). It is read from **`isProtected`**, and the name `Misc` is **never**
 * matched: nothing in this app resolves a category by name, a user may own a
 * separate category called `misc`, and a name match would break the moment the
 * server seeds a different word. Its Edit affordance stays — icon, glyph and
 * cap are still editable on it, and `CategoryEditForm` simply offers no name
 * field.
 *
 * @param {{
 *   category: object,
 *   canExpand: boolean,
 *   isExpanded: boolean,
 *   onToggleExpanded: () => void,
 *   rowActions: object,
 * }} props `rowActions` is one object rather than six props because every row
 *   in the list needs all of it and the child rows need it passed through
 *   unchanged — see ManageCategoriesScreen, which owns it.
 */
function ManageCategoryRow({ category, canExpand, isExpanded, onToggleExpanded, rowActions }) {
  const theme = useTheme();
  const styles = createStyles(theme);

  const subcategories = category.subcategories ?? [];
  const isAccordion = canExpand && subcategories.length > 0;
  const countLabel =
    subcategories.length === 1 ? '1 subcategory' : `${subcategories.length} subcategories`;
  const isEditing = rowActions.editingCategoryId === category.id;

  return (
    <View>
      <ListItem
        leading={<IconBadge glyph={category.glyph} tone="neutral" size="small" />}
        title={category.name}
        subtitle={isAccordion ? countLabel : undefined}
        onPress={isAccordion ? onToggleExpanded : undefined}
        trailing={
          <View style={styles.trailing}>
            <CategoryRowActions category={category} rowActions={rowActions} />
            {isAccordion ? (
              <ExpandChevron
                isExpanded={isExpanded}
                onPress={onToggleExpanded}
                accessibilityLabel={
                  isExpanded
                    ? `Hide subcategories of ${category.name}`
                    : `Show subcategories of ${category.name}`
                }
              />
            ) : null}
          </View>
        }
      />

      {isEditing ? (
        <View style={styles.editBlock}>
          <CategoryEditForm
            category={category}
            onSaved={rowActions.onSaved}
            onCancel={rowActions.cancelEdit}
          />
        </View>
      ) : null}

      {isAccordion && isExpanded ? (
        <View style={styles.expandedBlock}>
          {subcategories.map((subcategory) => (
            <ManageCategoryRow
              key={subcategory.id}
              category={subcategory}
              // A subcategory cannot have children (the one-level rule is
              // structural, not a filter), so it is never an accordion — and
              // recursing with `canExpand: false` is what says so once rather
              // than in a second, nearly-identical row component.
              canExpand={false}
              isExpanded={false}
              onToggleExpanded={onToggleExpanded}
              rowActions={rowActions}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

/**
 * The Edit and Delete affordances for one row.
 *
 * Placeholder `Text` glyphs standing in for Ionicons `create-outline` and
 * `trash-outline` (docs/ui/design-system.md §6/§11) — the icon library is
 * approved and still unlinked (docs/decisions/0002-icon-library-selection.md),
 * so this follows the glyph-fallback convention already used throughout the app
 * (ScreenHeader's ←/✕, ExpandChevron's ▾/▸, AddExpenseScreen's ▦). **The two
 * glyphs are the ones this app already uses for these two meanings** — ✎ for
 * edit and 🗑 for delete, the latter exactly as TransactionDetailScreen's
 * header delete button, including that ADR 0013 §1.1 chose it over ⌧ because ⌧
 * read as an "X". No new icon concept is introduced. The 🗑 risk that button
 * records applies here too: it sits in an emoji-heavy block and may render in
 * colour on some platform/font combinations.
 *
 * Nothing renders while this row's form is open — the form owns the
 * interaction, and a delete action beside an open edit form invites deleting
 * the thing you are in the middle of renaming.
 */
function CategoryRowActions({ category, rowActions }) {
  const theme = useTheme();
  const styles = createStyles(theme);

  if (rowActions.editingCategoryId === category.id) {
    return null;
  }

  // The §3.5 pre-flight for this row is in flight. Said rather than spun,
  // because the next thing the user sees is a destructive dialog and the pause
  // before it needs a reason (constitution §22).
  if (rowActions.preparingCategoryId === category.id) {
    return <Text style={styles.busyText}>Checking…</Text>;
  }

  // One write at a time, mirroring the store's single in-flight slot: while any
  // delete is running, no row offers either action.
  const isBusy = rowActions.isDeleting;

  return (
    <View style={styles.actions}>
      <Pressable
        onPress={() => rowActions.startEdit(category.id)}
        disabled={isBusy}
        hitSlop={theme.space.sm}
        accessibilityRole="button"
        accessibilityLabel={`Edit ${category.name}`}
        style={isBusy ? styles.actionDimmed : undefined}
      >
        <Text style={styles.actionIcon}>✎</Text>
      </Pressable>

      {/* `isProtected` only — never the name `Misc`. See the module note. */}
      {category.isProtected ? null : (
        <Pressable
          onPress={() => rowActions.requestDelete(category)}
          disabled={isBusy}
          hitSlop={theme.space.sm}
          accessibilityRole="button"
          accessibilityLabel={`Delete ${category.name}`}
          style={isBusy ? styles.actionDimmed : undefined}
        >
          <Text style={styles.actionIcon}>🗑</Text>
        </Pressable>
      )}
    </View>
  );
}

function createStyles(theme) {
  return StyleSheet.create({
    trailing: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    actions: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: theme.space.md,
      paddingHorizontal: theme.space.xs,
    },
    actionIcon: {
      color: theme.color.text.secondary,
      fontSize: 18,
    },
    // Matches PrimaryButton's own disabled opacity, the same shared dim
    // treatment ProfileScreen and this screen's inert toggle row already use.
    actionDimmed: {
      opacity: 0.5,
    },
    busyText: {
      color: theme.color.text.tertiary,
      fontSize: theme.type.caption.fontSize,
      paddingHorizontal: theme.space.xs,
    },
    // The same indented, tinted block Category Picker's expanded parent uses.
    // Duplicated rather than extracted: the two blocks hold different content
    // (that one also carries an inline "Add subcategory" form) and per-file
    // `createStyles` helpers are this codebase's convention — style objects are
    // not shared machinery anywhere in it. Only the chevron, which has to stay
    // pixel-identical and has to change in one place when the icon library
    // lands, was promoted to a component.
    expandedBlock: {
      marginLeft: theme.space.xl,
      marginBottom: theme.space.sm,
      backgroundColor: theme.color.background.surfaceAlt,
      borderRadius: theme.radius.md,
      paddingHorizontal: theme.space.md,
      paddingVertical: theme.space.xs,
    },
    // The edit form sits in the same tinted block as an expanded subcategory
    // list, so "this panel belongs to the row above it" reads the same way in
    // both cases. No left indent: the form is about the row, not nested under
    // it, and its fields need the width.
    editBlock: {
      marginBottom: theme.space.sm,
      backgroundColor: theme.color.background.surfaceAlt,
      borderRadius: theme.radius.md,
      paddingHorizontal: theme.space.md,
    },
  });
}

export default ManageCategoryRow;
