import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useTheme } from '../theme/useTheme';
import {
  useCategoryCreateForm,
  MAIN_MODE,
  SUBCATEGORY_MODE,
} from '../hooks/useCategoryCreateForm';
import Card from './Card';
import ListItem from './ListItem';
import TextInput from './TextInput';
import PrimaryButton from './PrimaryButton';
import SegmentedControl from './SegmentedControl';
import IconBadge from './IconBadge';
import ExpandChevron from './ExpandChevron';

const MODE_OPTIONS = [
  { label: 'Main Category', value: MAIN_MODE },
  { label: 'Subcategory', value: SUBCATEGORY_MODE },
];

/**
 * The "Add Category" affordance on Manage Categories (Project Owner addendum,
 * 2026-10-24) — a collapsed row that opens an inline create form.
 *
 * **Why this closes the gap rather than widening it.** The previous pass
 * shipped a Manage Categories screen that could only be read, and flagged
 * exactly that: *"a screen called Manage Categories that cannot add anything is
 * really Review Categories."* This is that gap closed. All of the state and all
 * of the rules live in `useCategoryCreateForm` — see that hook for why the
 * subcategory mode is derived rather than stored, why Category Picker is
 * deliberately not refactored onto it, and why nothing about creating a
 * category is re-validated here.
 *
 * **A row-that-expands, not a floating "+".** The addendum offered either. The
 * inline form wins on three counts: creating a category needs a name field, a
 * mode and (for a subcategory) a parent, so a FAB would only ever *open* this
 * same form one navigation step away; inline creation is already how this app
 * creates categories everywhere else (Category Picker's "Add Custom" and "Add
 * Subcategory", Budget Settings' "Add Category"), so there is no new pattern to
 * learn; and a second floating button on a screen that renders behind the
 * floating tab bar would have to be fitted into `theme/layout.js`'s geometry
 * alongside Dashboard's FAB for no gain. Collapsed to one row by default so the
 * list — which is what the screen is for — is not pushed down by a form nobody
 * asked for yet.
 *
 * **It sits above the list on purpose.** `useCategoriesStore.insertCategory`
 * prepends, so a new main category appears on the very next row, with no
 * scrolling and no refetch — which is the addendum's "should appear in the list
 * right away" satisfied by position rather than by a message. A new
 * *subcategory* lands inside its parent, which may be collapsed, so the screen
 * expands that parent on confirmation (`onCreated`).
 *
 * Lives in `src/components/` as a composite, feature-owned component and is
 * **not** added to the barrel — the same place and the same arrangement as
 * `ActivityLogItem`, `NotificationBell`, `ConfettiBurst` and
 * `ConfirmationDialog`, which the barrel also omits because it documents the
 * shared *base* library (ADR 0001). It is extracted from the screen rather than
 * written inside it because ManageCategoriesScreen is already near
 * constitution §26's component guideline.
 *
 * @param {{
 *   onCreated?: (created: { parentCategoryId: string | null }) => void,
 *   style?: object,
 * }} props
 */
function CategoryCreateForm({ onCreated, style }) {
  const theme = useTheme();
  const styles = createStyles(theme);
  const form = useCategoryCreateForm({ onCreated });

  return (
    <Card style={style}>
      <ListItem
        leading={<IconBadge glyph="+" tone="accent" size="small" />}
        title="Add Category"
        subtitle={
          form.canChooseMode
            ? 'Create a main category or a subcategory'
            : 'Create a main category'
        }
        onPress={form.toggleOpen}
        trailing={
          <ExpandChevron
            isExpanded={form.isOpen}
            onPress={form.toggleOpen}
            accessibilityLabel={form.isOpen ? 'Hide the add category form' : 'Add a category'}
          />
        }
      />

      {form.isOpen ? (
        <View style={styles.form}>
          {/* The subcategory choice appears only when it is genuinely
              available — the preference on AND at least one main category to
              nest under. With it withheld the form is exactly Category
              Picker's "Add Custom": one field, one button. */}
          {form.canChooseMode ? (
            <SegmentedControl
              options={MODE_OPTIONS}
              value={form.mode}
              onChange={form.changeMode}
              style={styles.modeControl}
            />
          ) : null}

          {form.isSubcategoryMode ? (
            <ParentCategoryField
              options={form.parentOptions}
              selectedParent={form.selectedParent}
              error={form.parentError}
              isListOpen={form.isParentListOpen}
              onToggleList={form.toggleParentList}
              onSelect={form.selectParent}
            />
          ) : null}

          <TextInput
            label={form.isSubcategoryMode ? 'SUBCATEGORY NAME' : 'CATEGORY NAME'}
            value={form.name}
            onChangeText={form.changeName}
            placeholder={
              form.isSubcategoryMode && form.selectedParent
                ? `New subcategory in ${form.selectedParent.name}`
                : 'e.g. Groceries'
            }
            error={form.nameError}
            // Category names are user-facing labels, so they sentence-case
            // like one. TextInput defaults to 'none' for the auth fields it
            // was built for; Category Picker's own create fields inherit that
            // default and are left alone (constitution §20).
            autoCapitalize="words"
          />

          <PrimaryButton
            label={form.isSubcategoryMode ? 'Add Subcategory' : 'Add Category'}
            glow={false}
            onPress={form.submit}
            disabled={!form.canSubmit}
            loading={form.isSubmitting}
            style={styles.submitButton}
          />

          {form.statusNote ? <Text style={styles.statusText}>{form.statusNote}</Text> : null}
        </View>
      ) : null}
    </Card>
  );
}

/**
 * The parent chooser, shown only in subcategory mode: a trigger field that
 * opens an in-place list of main categories.
 *
 * Follows Add Expense's GROUP field exactly — a bordered trigger that toggles a
 * tinted list directly below it (ADR 0003 §7.3's deliberate choice of an
 * in-place list over a pushed route for a short, account-scoped set). A
 * category list is the same kind of short set, and pushing a route to choose a
 * parent for a form that is itself an inline disclosure would be two levels of
 * indirection for one tap.
 *
 * `options` is already only main categories, so there is no filter here and no
 * way for a subcategory to be offered as a parent — the UI half of the
 * single-level rule that a DB trigger and the service's `400
 * SUBCATEGORY_DEPTH_EXCEEDED` enforce below it.
 */
function ParentCategoryField({
  options,
  selectedParent,
  error,
  isListOpen,
  onToggleList,
  onSelect,
}) {
  const theme = useTheme();
  const styles = createParentFieldStyles(theme);

  return (
    <View style={styles.container}>
      <Text style={styles.label}>MAIN CATEGORY</Text>
      <Pressable style={styles.trigger} onPress={onToggleList} accessibilityRole="button">
        {selectedParent ? (
          <Text style={styles.triggerText}>{selectedParent.name}</Text>
        ) : (
          <Text style={styles.triggerPlaceholder}>Choose a main category</Text>
        )}
      </Pressable>
      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      {isListOpen ? (
        <View style={styles.list}>
          {options.map((parent) => (
            <ListItem
              key={parent.id}
              leading={<IconBadge glyph={parent.glyph} tone="neutral" size="small" />}
              title={parent.name}
              onPress={() => onSelect(parent.id)}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

function createStyles(theme) {
  return StyleSheet.create({
    // The same indented, tinted disclosure block the two category accordions
    // use, so an expanded form reads as "inside" the row above it.
    form: {
      marginTop: theme.space.sm,
      backgroundColor: theme.color.background.surfaceAlt,
      borderRadius: theme.radius.md,
      paddingHorizontal: theme.space.md,
      paddingTop: theme.space.md,
      paddingBottom: theme.space.md,
    },
    modeControl: {
      marginBottom: theme.space.lg,
    },
    submitButton: {
      alignSelf: 'flex-start',
    },
    statusText: {
      color: theme.color.text.secondary,
      fontSize: theme.type.body.fontSize,
      marginTop: theme.space.sm,
    },
  });
}

function createParentFieldStyles(theme) {
  return StyleSheet.create({
    container: {
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
    trigger: {
      flexDirection: 'row',
      alignItems: 'center',
      borderBottomWidth: 1,
      borderBottomColor: theme.color.border.subtle,
      paddingBottom: theme.space.sm,
      minHeight: 40,
    },
    triggerText: {
      color: theme.color.text.primary,
      fontSize: theme.type.bodyLg.fontSize,
      fontWeight: theme.type.bodyLg.fontWeight,
    },
    triggerPlaceholder: {
      color: theme.color.text.tertiary,
      fontSize: theme.type.bodyLg.fontSize,
    },
    errorText: {
      color: theme.color.status.negative,
      fontSize: theme.type.caption.fontSize,
      marginTop: theme.space.xs,
    },
    list: {
      marginTop: theme.space.sm,
      backgroundColor: theme.color.background.surface,
      borderRadius: theme.radius.md,
      paddingHorizontal: theme.space.md,
      paddingBottom: theme.space.sm,
    },
  });
}

export default CategoryCreateForm;
