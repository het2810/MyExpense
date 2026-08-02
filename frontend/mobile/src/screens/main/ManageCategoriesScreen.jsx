import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme/useTheme';
import { getTabBarTopEdge } from '../../theme/layout';
import { useCategories } from '../../hooks/useCategories';
import { useCategoryDelete } from '../../hooks/useCategoryDelete';
import { useUserSettings } from '../../hooks/useUserSettings';
import { hasAnySubcategory } from '../../utils/categories';
import ScreenHeader from '../../components/ScreenHeader';
import Card from '../../components/Card';
import ListItem from '../../components/ListItem';
import ToggleSwitch from '../../components/ToggleSwitch';
import InlineMessage from '../../components/InlineMessage';
import ConfirmationDialog from '../../components/ConfirmationDialog';
import CategoryCreateForm from '../../components/CategoryCreateForm';
import ManageCategoryRow from '../../components/ManageCategoryRow';

/**
 * Manage Categories — the Subcategories switch and the category list it
 * reshapes, on one screen. Project Owner request, 2026-10-23.
 *
 * **Why it exists.** The switch shipped earlier the same day as a lone toggle
 * row on Profile (docs/decisions/0019-subcategories-one-optional-level.md
 * §10.5). A switch on its own never showed what enabling subcategories
 * actually *does* — the effect only appeared later, inside Category Picker.
 * Putting the switch directly above the list it changes makes the consequence
 * visible at the moment of the decision. Profile's row is now a plain
 * navigation row into here (profileMocks.js, `action: 'manage-categories'`),
 * registered as a push in ProfileStack.jsx alongside Activities and
 * BudgetSettings (docs/architecture/frontend-navigation.md §2.3) — a
 * drill-down into existing data, not a creation flow, so not a modal.
 *
 * **Nothing about the setting itself changed.** It is the same
 * `subcategoriesEnabled` field on `GET`/`PATCH /api/v1/users/me/settings`
 * (docs/api/api-overview.md §2.3/§2.4), read and written through the same
 * `useSettingsStore` action via `useUserSettings()`. No new storage, no new
 * key, no migration — an existing user's preference carries over untouched.
 * The categories come from the same `GET /categories` tree every other
 * category surface reads, through `useCategories()`; this screen adds no
 * second copy of that data and no request of its own. Screens never import
 * `src/api/*` (ADR 0016 §1), and nothing here does.
 *
 * ---
 * **THE LIST REACTS TO THE TOGGLE LIVE, AND ONLY TO CONFIRMED VALUES.**
 *
 * The shape is chosen by `settings.subcategoriesEnabled` on every render, so
 * flipping the switch re-renders the list in place — no reopening the screen,
 * no refetch (the tree already holds both levels either way; §6.1 — the server
 * is never consulted about this preference).
 *
 * Writes are pending-until-confirmed, not optimistic (see useSettingsStore's
 * module comment for why). That answers the "what does the list show while the
 * PATCH is in flight" question by construction: `subcategoriesEnabled` does
 * not move until the server answers, so the list keeps the shape the server
 * currently agrees with and then switches once — it never flashes a layout
 * that might be rejected. The cost is that a tap appears to do nothing for a
 * round trip, which is far more conspicuous here (the list is right there)
 * than it was on Profile, so the screen says so: a "Saving…" line under the
 * switch for exactly this field (`isSavingSubcategories`), and the switch
 * itself inert until the write settles.
 *
 * ---
 * **IT CREATES, AS OF THE PROJECT OWNER'S 2026-10-24 ADDENDUM.** The first
 * pass of this screen shipped read-only and flagged why that was wrong in its
 * own handoff — *"a screen called Manage Categories that cannot add anything is
 * really Review Categories."* `CategoryCreateForm` closes that: one collapsed
 * "Add Category" row above the list, opening an inline form that creates either
 * a main category or a subcategory under an existing main category, the second
 * option appearing only while the preference is on. See that component and
 * `useCategoryCreateForm` for the reasoning; nothing about the write itself is
 * new or re-validated here.
 *
 * ---
 * **IT RENAMES AND DELETES, AS OF THE RENAME/DELETE PASS.** The previous note
 * here said neither was possible because no endpoint existed. Both now do —
 * `PATCH /categories/{id}` (api-overview.md §3.3), `DELETE /categories/{id}`
 * (§3.4) and the `GET /categories/{id}/usage` pre-flight (§3.5), specified by
 * docs/decisions/0021-category-rename-propagates-and-misc-reassignment-on-delete.md
 * — so every row carries an Edit and a Delete affordance. The row markup, the
 * two affordances and the inline edit form live in `ManageCategoryRow` and
 * `CategoryEditForm`; the delete flow (count, then warn, then write) lives in
 * `useCategoryDelete`. **Reparenting still does not exist** (that ADR §2.6), so
 * a mis-parented subcategory is deleted and re-created rather than moved.
 *
 * Three rules this screen is the UI half of, each argued where it is
 * implemented:
 *
 * - **A protected category shows no Delete affordance and no name field** —
 *   read from `isProtected`, never matched on the name `Misc`
 *   (`ManageCategoryRow`, `useCategoryEditForm`).
 * - **The delete confirmation is worded from a server count read first**, and
 *   a failed count still warns rather than going quiet
 *   (`useCategoryDelete`, `utils/categoryDeleteWarning.js`).
 * - **A confirmed rename or delete makes held transactions stale**, because the
 *   server rewrites their category snapshot fields; the refetch is
 *   `useCategoriesStore`'s, not this screen's.
 *
 * The confirmation itself is the shared `ConfirmationDialog` (ADR 0013 §2) —
 * the same component Transaction Detail's Delete already uses. No second
 * dialog was written.
 */
function ManageCategoriesScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const styles = createStyles(theme, insets);

  const settings = useUserSettings();
  const { categories, hasLoaded, isLoading, loadError, reload } = useCategories();
  const categoryDelete = useCategoryDelete();

  // The server-confirmed value, never a value a tap merely asked for.
  const subcategoriesEnabled = settings.subcategoriesEnabled;

  // One parent open at a time, matching Category Picker's accordion exactly
  // (its `expandedParentId`) so the two screens behave identically.
  const [expandedCategoryId, setExpandedCategoryId] = useState(null);
  // One edit form open at a time, for the same reason the accordion is: two
  // open forms would be two drafts of two different rows competing for the
  // store's single in-flight write slot.
  const [editingCategoryId, setEditingCategoryId] = useState(null);

  // Collapse everything when the confirmed preference flips. Without this, a
  // parent left open before the switch went off would silently spring back
  // open when it went on again — the list should always come back collapsed,
  // which is the state the user can reason about.
  useEffect(() => {
    setExpandedCategoryId(null);
    // An open edit form goes with it. A subcategory's form would otherwise
    // still be "open" against a row the list has stopped rendering, and would
    // spring back the next time its parent was expanded.
    setEditingCategoryId(null);
  }, [subcategoriesEnabled]);

  // Inert until the server's value is known and while any settings write is in
  // flight — the store owns that reasoning (useSettingsStore), this is only how
  // it shows up here. Offline, the switch is read-only rather than flipping to
  // a value that was never saved.
  const isToggleDisabled = !settings.hasLoaded || settings.isBusy;

  // Only shown while the list is genuinely unknown; after a successful read a
  // stale list plus a visible error would be two contradictory answers.
  const listLoadError = hasLoaded ? null : loadError;
  // Withheld until there is a list to describe — "turn this on to break any of
  // these into a second level" is meaningless above a spinner or an empty
  // state, and the empty state says its own thing instead.
  const hasList = hasLoaded && categories.length > 0;
  const listNote = hasList
    ? getListNote(subcategoriesEnabled, hasAnySubcategory(categories))
    : null;

  function handleToggleExpanded(categoryId) {
    setExpandedCategoryId((previous) => (previous === categoryId ? null : categoryId));
  }

  /**
   * Reveals a just-created row, so "appears in the list right away" holds for
   * both kinds of create and not just the easy one.
   *
   * A new **main** category needs nothing from this: the store prepends, so it
   * is already the first row under the form. A new **subcategory** lands inside
   * its parent's `subcategories`, which may well be collapsed — the user would
   * then watch a confirmed write produce no visible change. Expanding that
   * parent is the whole fix. Memoized so the form's `submit` callback is stable
   * across renders.
   */
  const handleCategoryCreated = useCallback(({ parentCategoryId }) => {
    if (parentCategoryId) {
      setExpandedCategoryId(parentCategoryId);
    }
  }, []);

  const startEdit = useCallback((categoryId) => {
    setEditingCategoryId(categoryId);
  }, []);

  const cancelEdit = useCallback(() => {
    setEditingCategoryId(null);
  }, []);

  /**
   * Closes the form on a confirmed save. Nothing else is needed here: the store
   * has already written the server's updated row into the tree, so the row
   * behind the form is showing the new name by the time it closes — and the
   * transactions refetch that a rename now requires is the store's, not this
   * screen's (see the header note).
   */
  const handleCategorySaved = useCallback(() => {
    setEditingCategoryId(null);
  }, []);

  /**
   * Everything a row needs to offer Edit and Delete, in one object — see
   * `ManageCategoryRow`, which passes it through to its child rows unchanged.
   * Memoized so a row does not re-render on every keystroke in the create form
   * above it.
   */
  const rowActions = useMemo(
    () => ({
      editingCategoryId,
      startEdit,
      cancelEdit,
      onSaved: handleCategorySaved,
      requestDelete: categoryDelete.requestDelete,
      preparingCategoryId: categoryDelete.preparingCategoryId,
      isDeleting: categoryDelete.isDeleting,
    }),
    [
      editingCategoryId,
      startEdit,
      cancelEdit,
      handleCategorySaved,
      categoryDelete.requestDelete,
      categoryDelete.preparingCategoryId,
      categoryDelete.isDeleting,
    ],
  );

  return (
    <View style={styles.flex}>
      <ScreenHeader title="Manage Categories" onBack={() => navigation.goBack()} />

      {/* `keyboardShouldPersistTaps` became necessary when this screen gained
          a text field: without it, the first tap on "Add Category" while the
          keyboard is open only dismisses the keyboard and the user has to tap
          twice. Same reason CategoryPickerScreen's ScrollView already sets
          it. */}
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <Card style={styles.card}>
          <ListItem
            title="Subcategories"
            subtitle="Break categories into subcategories"
            style={isToggleDisabled ? styles.rowDimmed : undefined}
            trailing={
              <ToggleSwitch
                value={subcategoriesEnabled}
                // The setter takes the value the Switch reports rather than
                // flipping local state, so what is sent is exactly what the
                // user asked for. Deliberately not awaited: the store owns the
                // in-flight flag this card renders from.
                onValueChange={settings.setSubcategoriesEnabled}
                disabled={isToggleDisabled}
              />
            }
          />
          <ToggleStatusLine
            isSaving={settings.isSavingSubcategories}
            isUnknown={!settings.hasLoaded && !settings.loadError}
            style={styles.statusText}
          />
        </Card>

        {/* Copy is already mapped to user-facing wording by the API layer
            (src/api/errorMessages.js) — never a raw server message and never a
            stack trace (constitution §22). A failed read offers Retry; a
            failed write does not need one, since the switch is still there to
            tap again. */}
        <InlineMessage
          message={settings.saveError || settings.loadError}
          onRetry={settings.loadError ? settings.reload : null}
        />

        {/* Above the list, not below it: the store prepends a created row, so
            a new main category appears on the next row down with no scrolling
            (see the component's own note). */}
        <CategoryCreateForm onCreated={handleCategoryCreated} style={styles.card} />

        <Card style={styles.card}>
          <Text style={styles.sectionHeader}>All Categories</Text>
          {listNote ? <Text style={styles.sectionNote}>{listNote}</Text> : null}

          {/* Load states, constitution §22 — the same treatment Category
              Picker and Budget Settings already give this read: a failure says
              so and offers a retry rather than rendering an empty list that
              reads as "you have no categories". */}
          {!hasLoaded && isLoading ? (
            <Text style={styles.statusText}>Loading categories…</Text>
          ) : null}
          <InlineMessage
            message={listLoadError}
            onRetry={reload}
            style={styles.listMessage}
          />

          {hasLoaded && categories.length === 0 ? (
            <Text style={styles.statusText}>
              No categories yet. Use Add Category above to create your first one.
            </Text>
          ) : null}

          {/* A failed delete, next to the list the user is back looking at —
              the row and its Delete action are still there to try again, so no
              Retry button is offered (a destructive action should be re-aimed
              deliberately, not repeated by a button that remembers it). Copy
              is already user-facing (src/api/errorMessages.js); never a raw
              server message and never a stack trace (constitution §22). */}
          <InlineMessage message={categoryDelete.deleteError} style={styles.listMessage} />

          {hasList
            ? categories.map((category) => (
                // One row component for both shapes. With subcategories off,
                // `canExpand` is false and the list is the top level only — no
                // filter is written here, because the API's nested read shape
                // means the top-level array *is* the top level
                // (useCategoriesStore's note on why that is load-bearing).
                <ManageCategoryRow
                  key={category.id}
                  category={category}
                  canExpand={subcategoriesEnabled}
                  isExpanded={expandedCategoryId === category.id}
                  onToggleExpanded={() => handleToggleExpanded(category.id)}
                  rowActions={rowActions}
                />
              ))
            : null}
        </Card>
      </ScrollView>

      {/* The copy is built in utils/categoryDeleteWarning.js, which holds the
          Project Owner's own wording verbatim. This dialog renders a string and
          decides nothing. */}
      <ConfirmationDialog
        visible={categoryDelete.isDialogVisible}
        title={categoryDelete.dialogTitle}
        message={categoryDelete.dialogMessage}
        confirmLabel="Delete"
        destructive
        onConfirm={categoryDelete.confirmDelete}
        onCancel={categoryDelete.cancelDelete}
      />
    </View>
  );
}

/**
 * The one-line explanation under "All Categories". Four states, each answering
 * the question the user is most likely holding at that moment — which is the
 * whole reason this screen exists rather than a bare switch. The caller decides
 * whether there is a list to describe at all.
 *
 * The "nothing was deleted" wording in the off-with-subcategories case is not
 * reassurance for its own sake: turning the preference off hides and never
 * destroys (ADR 0019 §6.2), and that is exactly the thing a user cannot tell
 * by looking at a list that just got shorter.
 *
 * @param {boolean} subcategoriesEnabled The server-confirmed preference.
 * @param {boolean} hasSubcategories Whether any category has children.
 * @returns {string}
 */
function getListNote(subcategoriesEnabled, hasSubcategories) {
  if (subcategoriesEnabled && hasSubcategories) {
    return 'Tap a category to see its subcategories.';
  }
  if (subcategoriesEnabled) {
    return 'No subcategories yet. Use Add Category above to create one under any category.';
  }
  if (hasSubcategories) {
    return 'Subcategories are hidden. Turning them on shows the ones you already saved — nothing was deleted.';
  }
  return 'Turn on Subcategories to break any of these into a second level.';
}

/**
 * The status line under the switch. Separated out because it is the answer to
 * "what is happening right now" in a screen where a tap deliberately changes
 * nothing until the server agrees — see the header note on the in-flight
 * state. Renders nothing when the switch is simply idle.
 */
function ToggleStatusLine({ isSaving, isUnknown, style }) {
  if (isSaving) {
    return <Text style={style}>Saving… the list below updates once this is saved.</Text>;
  }
  if (isUnknown) {
    return <Text style={style}>Loading your preference…</Text>;
  }
  return null;
}

function createStyles(theme, insets) {
  return StyleSheet.create({
    flex: {
      flex: 1,
      backgroundColor: theme.color.background.base,
    },
    container: {
      flexGrow: 1,
      paddingHorizontal: theme.space.xl,
      // ScreenHeader owns the TOP inset for every route that renders it, so
      // none is added here (see its own note) — only the bottom needs work.
      paddingTop: theme.space.md,
      // Renders behind the floating tab bar, no FAB — the same helper and the
      // same comfortable gap ActivitiesScreen/ProfileScreen already use, so
      // this cannot drift out of sync with MainTabs' own geometry.
      paddingBottom: getTabBarTopEdge(theme, insets) + theme.space.lg,
    },
    card: {
      marginBottom: theme.space.xl,
    },
    sectionHeader: {
      color: theme.color.text.primary,
      fontSize: theme.type.h2.fontSize,
      lineHeight: theme.type.h2.lineHeight,
      fontWeight: theme.type.h2.fontWeight,
      marginBottom: theme.space.sm,
    },
    sectionNote: {
      color: theme.color.text.tertiary,
      fontSize: theme.type.caption.fontSize,
      lineHeight: theme.type.body.lineHeight,
      marginBottom: theme.space.sm,
    },
    statusText: {
      color: theme.color.text.secondary,
      fontSize: theme.type.body.fontSize,
      marginBottom: theme.space.sm,
    },
    // Sits inside the list card, which already pads itself.
    listMessage: {
      marginBottom: theme.space.sm,
    },
    // Matches PrimaryButton's own disabled opacity, the same shared dim
    // treatment ProfileScreen uses for an inert row.
    rowDimmed: {
      opacity: 0.5,
    },
  });
}

export default ManageCategoriesScreen;
