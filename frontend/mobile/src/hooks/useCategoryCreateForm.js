import { useCallback, useMemo, useState } from 'react';
import { useCategories } from './useCategories';

/**
 * The two things the form can create. `main` is the default and the fallback.
 * Exported so the component's mode control cannot drift from the values this
 * hook actually compares against — a silent mismatch there would leave the
 * control with no active segment and the form permanently in `main`.
 */
export const MAIN_MODE = 'main';
export const SUBCATEGORY_MODE = 'subcategory';

/**
 * All of the state and all of the decisions behind Manage Categories' "Add
 * Category" affordance (Project Owner addendum, 2026-10-24) — so
 * `CategoryCreateForm` is markup and nothing else (constitution §8).
 *
 * **It creates nothing itself.** The two writes are `useCategories()`'s
 * existing `createCategory(name)` / `createSubcategory(parentId, name)`, i.e.
 * the same real `POST /categories` calls Category Picker already makes, with
 * the same non-blank check, the same parent-scoped case-insensitive duplicate
 * check and the same single in-flight slot. Nothing about creating a category
 * is re-implemented or re-validated here, and the server's `409`/`404`/`400`
 * remain the guarantee (docs/architecture/security-architecture.md §3). What
 * this hook adds is the one thing the picker does not have: **a choice of
 * which of the two writes to make.**
 *
 * **Why a hook rather than the picker's shape.** Category Picker has two
 * independent create forms — a top-level one at the bottom of the screen and a
 * per-parent one inside each expanded accordion row — each with its own draft,
 * selected by *where* the user is typing. Manage Categories has one form that
 * has to ask *what* the user meant, because there is no expanded parent to
 * infer it from. One draft plus a mode is a genuinely different state machine
 * from two drafts, so the picker is deliberately **not** refactored onto this
 * (constitution §20/§25 — and it is verified working on device). What does get
 * shared is the part that actually generalises: the validation and the request,
 * which already lived in `useCategories`.
 *
 * ---
 * **THE SUBCATEGORY OPTION IS DERIVED, NEVER STORED.**
 *
 * `mode` is computed from `requestedMode` on every render and collapses to
 * `main` whenever a subcategory cannot be created. That covers two cases with
 * one line and no effect:
 *
 * - **The preference is off.** The addendum is explicit that the option
 *   "only appears when subcategories are enabled", and turning the switch off
 *   while this form sits open must not leave a dead mode selected. Stored
 *   state plus a reset effect could show a subcategory form for one render;
 *   derived state cannot.
 * - **The account has no main categories yet.** Only a main category may be a
 *   parent (ADR 0019 §2's one-level rule, enforced below the UI by a DB
 *   trigger, the service's `400 SUBCATEGORY_DEPTH_EXCEEDED` and this form's
 *   parent list), so with an empty tree there is nothing to nest under. The
 *   option is withheld rather than offered and then rejected.
 *
 * `parentOptions` is the store's top-level array **unfiltered**, which is
 * exactly the set of legal parents — the API's nested read shape means the top
 * level *is* the top level, so there is no filter here to forget
 * (useCategoriesStore's note on why that is load-bearing).
 *
 * @param {{ onCreated?: (created: { parentCategoryId: string | null }) => void }} [options]
 *   `onCreated` fires only after the server has confirmed the write, and
 *   carries the parent it went under (`null` for a main category) so the screen
 *   can reveal the new row — see ManageCategoriesScreen.
 * @returns {object} The form's state plus its handlers.
 */
export function useCategoryCreateForm({ onCreated } = {}) {
  const {
    categories,
    subcategoriesEnabled,
    hasLoaded,
    isLoading,
    isCreating,
    createCategory,
    createSubcategory,
  } = useCategories();

  const [isOpen, setIsOpen] = useState(false);
  const [requestedMode, setRequestedMode] = useState(MAIN_MODE);
  const [name, setName] = useState('');
  const [parentCategoryId, setParentCategoryId] = useState(null);
  const [isParentListOpen, setIsParentListOpen] = useState(false);
  const [nameError, setNameError] = useState(null);
  const [parentError, setParentError] = useState(null);

  // Every legal parent, and only legal parents (see the module note).
  const parentOptions = categories;
  const canChooseMode = subcategoriesEnabled && parentOptions.length > 0;
  const mode = canChooseMode ? requestedMode : MAIN_MODE;
  const isSubcategoryMode = mode === SUBCATEGORY_MODE;

  const selectedParent = useMemo(
    () => parentOptions.find((category) => category.id === parentCategoryId) ?? null,
    [parentOptions, parentCategoryId],
  );

  const toggleOpen = useCallback(() => {
    setIsOpen((previous) => !previous);
  }, []);

  const changeMode = useCallback((nextMode) => {
    setRequestedMode(nextMode);
    // Both messages belong to the form the user just left. The typed name is
    // kept on purpose: switching mode after a duplicate rejection is a likely
    // next move ("fine, make it a subcategory instead"), and clearing the
    // field would make them retype it.
    setNameError(null);
    setParentError(null);
    setIsParentListOpen(false);
  }, []);

  const changeName = useCallback((nextName) => {
    setName(nextName);
    setNameError(null);
  }, []);

  const toggleParentList = useCallback(() => {
    setIsParentListOpen((previous) => !previous);
  }, []);

  const selectParent = useCallback((nextParentCategoryId) => {
    setParentCategoryId(nextParentCategoryId);
    setIsParentListOpen(false);
    setParentError(null);
  }, []);

  /**
   * Routes to one of the two writes and reports the outcome inline.
   *
   * The only check this hook makes itself is "a subcategory needs a parent" —
   * which has no equivalent in `useCategories` because the picker always knows
   * its parent from context. Everything else (blank name, duplicate sibling,
   * and every server failure) comes back as the single `error` string and lands
   * under the name field, which is where Category Picker already puts it
   * (constitution §3.4). A `null` error means the store refused the write
   * because the session ended mid-request — there is nothing useful to say on a
   * screen that is being torn down (errorMessages.isSessionTerminalError).
   */
  const submit = useCallback(async () => {
    if (isSubcategoryMode && !parentCategoryId) {
      setParentError('Choose the main category this belongs under.');
      return;
    }

    const { success, error } = isSubcategoryMode
      ? await createSubcategory(parentCategoryId, name)
      : await createCategory(name);

    if (!success) {
      setNameError(error);
      return;
    }

    // The form stays open and the mode and parent stay as they were: adding
    // several subcategories to one parent in a row is the common case, and the
    // new rows appear in the list immediately below.
    setName('');
    setNameError(null);
    setParentError(null);
    if (onCreated) {
      onCreated({ parentCategoryId: isSubcategoryMode ? parentCategoryId : null });
    }
  }, [isSubcategoryMode, parentCategoryId, name, createCategory, createSubcategory, onCreated]);

  return {
    isOpen,
    toggleOpen,
    mode,
    canChooseMode,
    isSubcategoryMode,
    changeMode,
    name,
    changeName,
    nameError,
    parentOptions,
    selectedParent,
    parentError,
    isParentListOpen,
    toggleParentList,
    selectParent,
    submit,
    isSubmitting: isCreating,
    // Nothing may be created before a successful read: there is no sibling list
    // to have checked the name against and no parent to attach a child to (the
    // store refuses such a write outright — useCategoriesStore.createCategory).
    canSubmit: hasLoaded && !isCreating,
    statusNote: getStatusNote(hasLoaded, isLoading),
  };
}

/**
 * Why the form cannot be submitted yet, or `null` when it can (constitution
 * §22 — the button being inert is not an explanation). The failed-read case is
 * worded as a statement rather than an action because the list above this form
 * already owns the Retry.
 *
 * @param {boolean} hasLoaded
 * @param {boolean} isLoading
 * @returns {string | null}
 */
function getStatusNote(hasLoaded, isLoading) {
  if (hasLoaded) {
    return null;
  }
  if (isLoading) {
    return 'Loading your categories…';
  }
  return 'Your categories have not loaded yet, so nothing can be added.';
}
