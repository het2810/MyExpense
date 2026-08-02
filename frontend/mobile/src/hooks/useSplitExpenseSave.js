import { useCallback } from 'react';
import { useSplitExpensesStore } from '../store/useSplitExpensesStore';
import { useGroupsStore } from '../store/useGroupsStore';
import { useIndividualSplitsStore } from '../store/useIndividualSplitsStore';
import { useTransactionsStore } from '../store/useTransactionsStore';
import { useSplitFeedStore } from '../store/useSplitFeedStore';
import { getErrorMessage } from '../api/errorMessages';
import { estimateSplitBalanceEffects } from '../utils/splitEstimates';
import { getCurrentTimeString } from '../utils/dateDisplay';
import { buildSplitExpenseUpdateRequest, projectSplitExpenseEdit } from '../utils/splitEdit';
import { resolveSplitExpenseCounterparts } from '../utils/splitParticipants';
import { useUserIdentity } from './useUserIdentity';

/**
 * @param {object} splitValues
 * @param {boolean} addToPersonalExpenses
 * @param {number} yourShare
 * @returns {object}
 */
function buildOfflinePreview(splitValues, addToPersonalExpenses, yourShare) {
  const effects = estimateSplitBalanceEffects(splitValues);
  const categorySnapshot = splitValues.categorySnapshot ?? null;
  return {
    ...effects,
    categorySnapshot,
    personalRow: addToPersonalExpenses
      ? {
          title: splitValues.title,
          amount: yourShare,
          type: 'expense',
          scope: splitValues.splitMode === 'group' ? 'group' : 'personal',
          groupId: splitValues.splitMode === 'group' ? splitValues.groupId : null,
          txnDate: splitValues.splitDate,
          txnTime: getCurrentTimeString(),
          categoryId: splitValues.categoryId ?? null,
          categoryName: categorySnapshot?.categoryName ?? 'Misc',
          parentCategoryName: null,
          categoryIconName: categorySnapshot?.categoryIconName ?? null,
          categoryGlyph: categorySnapshot?.categoryGlyph ?? 'M',
          categoryTone: 'neutral',
          paymentMode: null,
          cashAmount: null,
          onlineAmount: null,
          notes: null,
          receiptPublicId: null,
          version: 0,
        }
      : null,
  };
}

/**
 * The save sequence behind Split Add Expense's checkmark: the split expense,
 * then the balance refresh, then (when "add to my expenses" was ticked) pulling
 * the server-created personal transaction into the Dashboard list.
 *
 * **The personal transaction is written by the SERVER**, in the same database
 * transaction as the split (§9.1 step 3, `addToPersonalExpenses: true`). That
 * replaced the old client-side `POST /transactions`, which existed only while
 * the backend refused group-scoped transaction writes (`403
 * NOT_GROUP_MEMBER`, since fixed). The server-side write:
 * - is atomic with the split — no "split failed but your expense was saved"
 *   partial state any more;
 * - links the rows (`transactions.split_expense_id`), so the Dashboard shows a
 *   SPLIT tag instead of a misleading "Cash" payment mode;
 * - records the caller's CONSUMPTION share, never what they paid (ADR 0025 §7).
 *
 * Kept out of the screen because the order of these steps is the feature
 * (constitution §8).
 */
export function useSplitExpenseSave() {
  const createSplitExpense = useSplitExpensesStore((state) => state.createSplitExpense);
  const isSaving = useSplitExpensesStore((state) => state.isSaving);
  const reloadGroup = useGroupsStore((state) => state.reloadGroup);
  const loadIndividualBalances = useIndividualSplitsStore(
    (state) => state.loadIndividualBalances,
  );
  const adoptCreatedTransaction = useTransactionsStore(
    (state) => state.adoptCreatedTransaction,
  );

  const saveSplitExpense = useCallback(
    /**
     * @param {{
     *   title: string,
     *   categoryId: string | null,
     *   splitDate: string,
     *   amount: number,
     *   splitMode: 'individual' | 'group',
     *   groupId: string | null,
     *   individualCounterpartContactIds: string[] | null,
     *   splitConfig: object,
     *   participants: object[],
     *   addToExpenses: boolean,
     *   yourShare: number,
     * }} values
     * @returns {Promise<{ success: boolean, splitExpense: object | null,
     *   personalTransactionId: string | null, error: string | null }>}
     */
    async (values) => {
      const { addToExpenses, yourShare, ...splitValues } = values;
      const addToPersonalExpenses = addToExpenses && yourShare > 0;

      const result = await createSplitExpense({
        ...splitValues,
        addToPersonalExpenses,
        // Display-only inputs for the queued-write path's estimates and the
        // overlay's personal row (ADR 0027 §8.8). Ignored by the request
        // builder, so the direct-call body is unchanged.
        offline: buildOfflinePreview(splitValues, addToPersonalExpenses, yourShare),
      });

      if (!result.success) {
        return {
          success: false,
          splitExpense: null,
          personalTransactionId: null,
          error: result.error,
        };
      }

      const { splitExpense } = result;
      if (result.pending) {
        // Queued (OFFLINE_WRITES_ENABLED): nothing to re-read yet. The overlay
        // shows the split, the personal row and the balance estimates; the
        // engine's pull replaces them with server truth after the flush.
        return {
          success: true,
          splitExpense,
          personalTransactionId: splitExpense?.personalTransactionId ?? null,
          error: null,
        };
      }
      if (splitExpense.groupId) {
        await reloadGroup(splitExpense.groupId);
      } else {
        await loadIndividualBalances({ force: true });
      }
      if (splitExpense.personalTransactionId) {
        await adoptCreatedTransaction(splitExpense.personalTransactionId);
      }

      return {
        success: true,
        splitExpense,
        personalTransactionId: splitExpense.personalTransactionId ?? null,
        error: null,
      };
    },
    [createSplitExpense, reloadGroup, loadIndividualBalances, adoptCreatedTransaction],
  );

  const updateInStore = useSplitExpensesStore((state) => state.updateSplitExpense);
  const deleteInStore = useSplitExpensesStore((state) => state.deleteSplitExpense);
  const loadFeed = useSplitFeedStore((state) => state.loadFeed);
  const loadTransactions = useTransactionsStore((state) => state.loadTransactions);
  const { userId } = useUserIdentity();

  /**
   * After a direct (non-queued) edit or delete: everything it moved is
   * re-read, never adjusted locally (ADR 0023 §1) — the balance, the feeds
   * that hold the split, and the creator's personal transaction (§5).
   */
  const refreshAfterLedgerWrite = useCallback(
    async (splitExpense) => {
      if (splitExpense.splitMode === 'group') {
        await reloadGroup(splitExpense.groupId);
        loadFeed({ groupId: splitExpense.groupId }, { force: true });
      } else {
        await loadIndividualBalances({ force: true });
        resolveSplitExpenseCounterparts(splitExpense).forEach((counterpart) => {
          if (counterpart.individualBalanceId) {
            loadFeed({ individualBalanceId: counterpart.individualBalanceId }, { force: true });
          }
        });
      }
      if (splitExpense.personalTransactionId) {
        loadTransactions({ force: true });
      }
    },
    [reloadGroup, loadIndividualBalances, loadFeed, loadTransactions],
  );

  const updateSplitExpense = useCallback(
    /**
     * Split Add Expense's save in edit mode (ADR 0028 §11.5).
     *
     * @param {{ splitExpense: object, title: string, categoryId: string | null,
     *   categorySnapshot: object | null, splitDate: string, amount: number,
     *   splitConfig: object, participants: object[] }} values
     * @returns {Promise<{ success: boolean, error: string | null }>}
     */
    async ({ splitExpense, categorySnapshot, ...formValues }) => {
      let body;
      let after;
      try {
        body = buildSplitExpenseUpdateRequest(formValues, splitExpense);
        after = projectSplitExpenseEdit(
          splitExpense,
          body,
          formValues.participants,
          body.categoryId ? categorySnapshot : null,
        );
      } catch (error) {
        return { success: false, error: getErrorMessage(error) };
      }
      const result = await updateInStore(splitExpense.id, {
        splitExpense,
        body,
        after,
        currentUserId: userId,
      });
      if (result.success && !result.pending) {
        await refreshAfterLedgerWrite(splitExpense);
      }
      return { success: result.success, error: result.error };
    },
    [updateInStore, refreshAfterLedgerWrite, userId],
  );

  const deleteSplitExpense = useCallback(
    /**
     * Split Expense Detail's Delete (ADR 0028 §11.6).
     *
     * @param {object} splitExpense
     * @returns {Promise<{ success: boolean, error: string | null }>}
     */
    async (splitExpense) => {
      const result = await deleteInStore(splitExpense.id, { splitExpense, currentUserId: userId });
      if (result.success && !result.pending) {
        await refreshAfterLedgerWrite(splitExpense);
      }
      return { success: result.success, error: result.error };
    },
    [deleteInStore, refreshAfterLedgerWrite, userId],
  );

  return { saveSplitExpense, updateSplitExpense, deleteSplitExpense, isSaving };
}
