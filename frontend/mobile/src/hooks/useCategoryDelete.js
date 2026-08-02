import { useCallback, useState } from 'react';
import { useCategories } from './useCategories';
import { buildCategoryDeleteMessage } from '../utils/categoryDeleteWarning';

/**
 * The whole delete-a-category flow for Manage Categories: the pre-flight read,
 * the confirmation copy it produces, and the write the user confirms
 * (docs/api/api-overview.md §3.4/§3.5,
 * docs/decisions/0021-category-rename-propagates-and-misc-reassignment-on-delete.md
 * §2.2).
 *
 * Kept out of the screen because **the order of these three steps is the
 * feature** (constitution §8): count first, warn second, delete third. A screen
 * that owned this would be one `useEffect` away from showing the dialog before
 * the count arrives.
 *
 * ---
 * **THE PRE-FLIGHT, AND WHY IT FAILS CLOSED.**
 *
 * Tapping delete calls `GET /categories/{id}/usage` **before** the dialog
 * opens, and `transactionCount > 0` chooses the wording. §3.5 is explicit about
 * the failure path and it is the part worth reading twice: **if that call
 * fails — offline, timeout, anything — the warning is shown anyway and must
 * NOT be suppressed.** A dialog that implied a category was empty because a
 * count request timed out would send a user's transactions to `Misc` without
 * telling them, which is the one outcome a destructive flow may not produce
 * (constitution §22, §29 — correctness first).
 *
 * The count is also **never** derived from `useTransactionsStore`. That store
 * holds one filtered page of a paginated list, so a category with 300
 * transactions, none of them on the loaded page, would delete with no warning
 * at all. §3.5 rejects that option by name, and this is the rule it states:
 * **a client must never derive a total from a paginated list.**
 *
 * The subcategory number is different, and the distinction is deliberate: when
 * the pre-flight fails, the count of children falls back to **the held tree**,
 * because `GET /categories` is not paginated and the app is displaying that
 * row's children already. See `utils/categoryDeleteWarning.js`.
 *
 * ---
 * **THE PROTECTED ROW NEVER REACHES HERE.** `isProtected: true` (§3.1) gets no
 * delete affordance at all — not a disabled one — so there is no guard in this
 * hook and none is wanted: the row is excluded by the UI, keyed off that field
 * and never off the name `Misc`. The server's `400 CATEGORY_PROTECTED` is the
 * backstop, mapped in `errorMessages.js` for the stale-tree case.
 *
 * @returns {object} The dialog's props plus the three handlers the rows need.
 */
export function useCategoryDelete() {
  const { deleteCategory, fetchCategoryUsage, isDeleting } = useCategories();

  // The row the dialog is currently asking about, with the copy already
  // resolved — so the dialog renders a string and makes no decisions, and the
  // message cannot change under the user between the count arriving and the
  // tap landing.
  const [pendingDelete, setPendingDelete] = useState(null);
  // Which row's pre-flight is in flight, so that row (and only that row) can
  // say so. `null` the moment the dialog opens.
  const [preparingCategoryId, setPreparingCategoryId] = useState(null);
  const [deleteError, setDeleteError] = useState(null);

  /**
   * Step 1 — the user tapped delete on `category`. Reads the usage counts,
   * then opens the dialog with the wording they produce.
   *
   * The dialog opens **either way**: a failed count changes the copy, never
   * whether the user is warned.
   */
  const requestDelete = useCallback(
    async (category) => {
      setDeleteError(null);
      setPreparingCategoryId(category.id);

      const { success, usage } = await fetchCategoryUsage(category.id);

      setPreparingCategoryId(null);
      setPendingDelete({
        categoryId: category.id,
        message: buildCategoryDeleteMessage({
          categoryName: category.name,
          transactionCount: success ? usage.transactionCount : 0,
          subcategoryCount: success
            ? usage.subcategoryCount
            : (category.subcategories ?? []).length,
          isUsageKnown: success,
        }),
      });
    },
    [fetchCategoryUsage],
  );

  /**
   * Step 3 — the user confirmed. Closes the dialog on either outcome: on
   * success the row is gone, and on failure the message belongs next to the
   * list the user is back looking at, where the row (and its delete action) is
   * still there to try again.
   *
   * A `404` is **success** inside the store, so it never lands here as an error
   * (§3.4 — the delete is idempotent in effect, and a user who already
   * confirmed should not be told their delete failed because it had already
   * happened).
   */
  const confirmDelete = useCallback(async () => {
    // A second tap on Confirm while the first is still in flight. The store
    // refuses it anyway (one delete at a time), but refusing it here keeps the
    // dialog open and the copy on screen until the real answer arrives, rather
    // than closing on the refusal of a duplicate. `ConfirmationDialog` is
    // shared with Transaction Detail's Delete and has no in-flight state of its
    // own; this is the local remedy rather than a new prop on it.
    if (!pendingDelete || isDeleting) {
      return;
    }
    const { categoryId } = pendingDelete;
    const result = await deleteCategory(categoryId);
    setPendingDelete(null);
    setDeleteError(result.success ? null : result.error);
  }, [pendingDelete, isDeleting, deleteCategory]);

  const cancelDelete = useCallback(() => {
    setPendingDelete(null);
  }, []);

  return {
    requestDelete,
    confirmDelete,
    cancelDelete,
    isDialogVisible: pendingDelete != null,
    dialogTitle: 'Delete Category',
    dialogMessage: pendingDelete ? pendingDelete.message : '',
    preparingCategoryId,
    isDeleting,
    deleteError,
  };
}
