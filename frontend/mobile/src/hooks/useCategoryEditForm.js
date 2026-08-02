import { useCallback, useState } from 'react';
import { useCategories } from './useCategories';

/**
 * All of the state and all of the decisions behind one category row's inline
 * edit form (`PATCH /api/v1/categories/{id}`, docs/api/api-overview.md §3.3),
 * so `CategoryEditForm` is markup and nothing else (constitution §8). The same
 * arrangement `useCategoryCreateForm` already has for the create form directly
 * above it on the same screen.
 *
 * **It writes nothing itself.** The write is `useCategories().updateCategory`,
 * which owns the two client-side rules (a non-blank name, and no duplicate
 * among this row's siblings *excluding itself*) and turns this form's draft
 * into the endpoint's partial body. The server re-validates all of it
 * (docs/architecture/security-architecture.md §3).
 *
 * ---
 * **WHICH FIELDS EXIST IS DECIDED BY THE ROW, NOT BY A DISABLED FLAG.**
 *
 * Two exclusions, and both are an absent field rather than a greyed-out one —
 * because `PATCH` reads an absent field as "leave this column alone", so a
 * field the form does not offer is a field the request cannot carry:
 *
 * - **A protected row has no name field** (`isProtected: true`, §3.1 — exactly
 *   one row per account, the seeded `Misc`). Renaming it is `400
 *   CATEGORY_PROTECTED` server-side, and it is the reassignment target every
 *   category delete depends on. **Keyed off `isProtected` only; the name `Misc`
 *   is never matched** (nothing in this app resolves a category by name, and a
 *   user may own a separate category called `misc`). Its icon, glyph and cap
 *   stay editable, exactly as the contract allows.
 * - **A subcategory has no cap field.** Caps are top-level-only — a parent's
 *   cap already includes its children's spending — and a cap on a child is a
 *   `400 VALIDATION_ERROR` (§3.2/§3.3).
 *
 * A greyed-out field would have needed the same two conditions written again
 * at submit time to stop the value being sent; an absent one cannot be sent at
 * all.
 *
 * ---
 * **WHAT IS NOT EDITABLE HERE, AND WHY.**
 *
 * `iconName` is accepted by §3.3 and by every layer below this hook, but there
 * is **no icon picker anywhere in this app** — `react-native-vector-icons` is
 * approved and still unlinked (docs/decisions/0002-icon-library-selection.md),
 * every icon in the UI is a placeholder `Text` glyph, and every user-created
 * category is given the one neutral approved name (`settings-outline`,
 * `utils/categories.js`). Offering a free-text `iconName` field would invite a
 * value that is not in design-system.md §6's approved set. The **glyph** is
 * what actually renders today (`IconBadge`), so the glyph is what this form
 * edits. Flagged for the pass that links the icon library.
 *
 * `parentCategoryId` is not editable either, and that is the contract's
 * position rather than this hook's: a row's level is fixed at creation and
 * reparenting is still undesigned
 * (docs/decisions/0021-category-rename-propagates-and-misc-reassignment-on-delete.md
 * §2.6).
 *
 * @param {{ category: object, onSaved?: (saved: { categoryId: string }) => void }} params
 *   `category` is the live tree row being edited. `onSaved` fires only after
 *   the server has confirmed the write — the screen closes the form on it.
 * @returns {object} The form's state plus its handlers.
 */
export function useCategoryEditForm({ category, onSaved }) {
  const { updateCategory, isUpdating } = useCategories();

  const canEditName = category.isProtected !== true;
  const canEditCap = category.parentCategoryId == null;

  const [name, setName] = useState(category.name);
  const [glyph, setGlyph] = useState(category.glyph);
  const [monthlyCap, setMonthlyCap] = useState(
    category.monthlyCap != null ? String(category.monthlyCap) : '',
  );
  const [error, setError] = useState(null);

  const changeName = useCallback((nextName) => {
    setName(nextName);
    setError(null);
  }, []);

  const changeGlyph = useCallback((nextGlyph) => {
    setGlyph(nextGlyph);
    setError(null);
  }, []);

  const changeMonthlyCap = useCallback((nextCap) => {
    setMonthlyCap(nextCap);
    setError(null);
  }, []);

  /**
   * Builds the draft, validates the two fields this form owns outright, and
   * hands the rest to `updateCategory`.
   *
   * **Only the keys this form renders go into the draft** (see the module
   * note). A `null` error back from the store means the session ended
   * mid-request — there is nothing useful to say on a screen that is being
   * torn down (`errorMessages.isSessionTerminalError`).
   */
  const submit = useCallback(async () => {
    const trimmedGlyph = glyph.trim();
    if (!trimmedGlyph) {
      setError('Enter a one or two character glyph — it is what the category badge shows.');
      return;
    }
    if (trimmedGlyph.length > 2) {
      setError('A glyph can be one or two characters.');
      return;
    }

    const draft = { glyph: trimmedGlyph };
    if (canEditName) {
      draft.name = name;
    }
    if (canEditCap) {
      const cap = parseMonthlyCap(monthlyCap);
      if (!cap.isValid) {
        setError('Enter a monthly cap greater than 0, or clear the field to remove the cap.');
        return;
      }
      draft.monthlyCap = cap.value;
    }

    const result = await updateCategory(category.id, draft);
    if (!result.success) {
      setError(result.error);
      return;
    }

    setError(null);
    if (onSaved) {
      onSaved({ categoryId: category.id });
    }
  }, [glyph, name, monthlyCap, canEditName, canEditCap, category.id, updateCategory, onSaved]);

  return {
    name,
    changeName,
    glyph,
    changeGlyph,
    monthlyCap,
    changeMonthlyCap,
    canEditName,
    canEditCap,
    error,
    submit,
    isSubmitting: isUpdating,
    canSubmit: !isUpdating,
    // Shown in place of the name field, so an absent field reads as a rule
    // rather than as something missing (constitution §22). It says what the row
    // is FOR rather than naming it, for the reason the module note gives.
    nameLockedNote: canEditName
      ? null
      : 'This category holds transactions from categories you delete, so its name is fixed.',
  };
}

/**
 * Parses the cap field. Blank is a legitimate value — it **clears** the cap —
 * which is the one place this form sends an explicit `null` rather than
 * omitting a field (api-overview.md §3.3's absent-vs-null rule).
 *
 * `> 0` matches the contract (§3.2); `0` is not "no cap", it is a cap of zero,
 * which would read as "every rupee is an overspend" and is rejected rather
 * than quietly converted to `null`.
 *
 * @param {string} value The raw field text.
 * @returns {{ isValid: boolean, value: number | null }}
 */
function parseMonthlyCap(value) {
  const trimmed = value.trim();
  if (!trimmed) {
    return { isValid: true, value: null };
  }
  const parsed = parseFloat(trimmed);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return { isValid: false, value: null };
  }
  return { isValid: true, value: parsed };
}
