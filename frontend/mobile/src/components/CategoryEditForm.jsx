import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useTheme } from '../theme/useTheme';
import { useCategoryEditForm } from '../hooks/useCategoryEditForm';
import TextInput from './TextInput';
import PrimaryButton from './PrimaryButton';
import TextButton from './TextButton';

/**
 * The inline edit form for one category row on Manage Categories —
 * `PATCH /api/v1/categories/{id}` (docs/api/api-overview.md §3.3).
 *
 * **Markup only.** Every rule — which fields exist for this row, what is
 * valid, what is sent, and the absent-vs-`null` discipline the endpoint reads
 * the body with — lives in `useCategoryEditForm`. Read that hook before
 * changing anything here; in particular, **a field is absent rather than
 * disabled** when the row may not change it, which is what keeps a value the
 * user cannot see out of the request body.
 *
 * It mirrors `CategoryCreateForm`, directly above it on the same screen: the
 * same `TextInput`s, the same `PrimaryButton`, the same single error line under
 * the field it belongs to. The differences are that it opens **per row** rather
 * than once per screen, and that it has a Cancel — an edit form that can only
 * be escaped by saving would be a trap on a destructive-adjacent surface.
 *
 * Lives in `src/components/` as a composite, feature-owned component and is
 * **not** added to the barrel — the same place and arrangement as
 * `CategoryCreateForm`, `ActivityLogItem`, `NotificationBell` and
 * `ConfirmationDialog`, which the barrel also omits because it documents the
 * shared *base* library (ADR 0001).
 *
 * @param {{
 *   category: object,
 *   onSaved?: (saved: { categoryId: string }) => void,
 *   onCancel: () => void,
 * }} props
 */
function CategoryEditForm({ category, onSaved, onCancel }) {
  const theme = useTheme();
  const styles = createStyles(theme);
  const form = useCategoryEditForm({ category, onSaved });

  return (
    <View style={styles.form}>
      {form.canEditName ? (
        <TextInput
          label="CATEGORY NAME"
          value={form.name}
          onChangeText={form.changeName}
          placeholder="e.g. Groceries"
          // Category names are user-facing labels, so they sentence-case like
          // one — the same choice CategoryCreateForm makes and for the same
          // reason.
          autoCapitalize="words"
        />
      ) : (
        <Text style={styles.lockedNote}>{form.nameLockedNote}</Text>
      )}

      {/* The glyph, not the icon: `IconBadge` renders this character, and the
          approved Ionicons set is not installed yet, so this is the part of a
          category's appearance a user can actually change today. See the
          hook's note on `iconName`. */}
      <TextInput
        label="BADGE GLYPH"
        value={form.glyph}
        onChangeText={form.changeGlyph}
        placeholder="e.g. G"
        autoCapitalize="characters"
        maxLength={2}
      />

      {form.canEditCap ? (
        <TextInput
          label="MONTHLY CAP"
          value={form.monthlyCap}
          onChangeText={form.changeMonthlyCap}
          placeholder="Leave blank for no cap"
          keyboardType="decimal-pad"
          helperText="A main category's cap includes everything spent in its subcategories."
        />
      ) : null}

      {/* One error line for the whole form, under the fields, which is where
          Category Picker and the create form already put it (constitution
          §3.4). Copy is already user-facing — never a raw server message and
          never a stack trace (constitution §22). */}
      {form.error ? <Text style={styles.errorText}>{form.error}</Text> : null}

      <PrimaryButton
        label="Save Changes"
        glow={false}
        onPress={form.submit}
        disabled={!form.canSubmit}
        loading={form.isSubmitting}
        style={styles.submitButton}
      />
      <TextButton label="Cancel" onPress={onCancel} style={styles.cancelButton} />
    </View>
  );
}

function createStyles(theme) {
  return StyleSheet.create({
    form: {
      paddingTop: theme.space.sm,
      paddingBottom: theme.space.md,
    },
    lockedNote: {
      color: theme.color.text.tertiary,
      fontSize: theme.type.caption.fontSize,
      lineHeight: theme.type.body.lineHeight,
      marginBottom: theme.space.sm,
    },
    errorText: {
      color: theme.color.status.negative,
      fontSize: theme.type.caption.fontSize,
      lineHeight: theme.type.body.lineHeight,
      marginBottom: theme.space.sm,
    },
    submitButton: {
      marginTop: theme.space.sm,
    },
    cancelButton: {
      alignSelf: 'center',
      marginTop: theme.space.xs,
    },
  });
}

export default CategoryEditForm;
