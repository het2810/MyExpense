import { create } from 'zustand';

/**
 * Zustand store holding the flat, first-class list of itemized split
 * expense records — docs/decisions/0005-split-add-expense-flow.md §2.3.
 *
 * A split expense's full detail (amount, category, date, all participants,
 * who paid, method, per-person computed amounts) doesn't fit into either
 * `useIndividualSplitsStore` or `useGroupsStore` entries, which are — and
 * must remain — aggregate/summary records (one row per person/group, not
 * one row per split event). This mirrors, rather than diverges from, the
 * existing `useTransactionsStore` vs. `useGroupsStore` relationship (flat
 * list, referenced by id) — see the ADR for the full rationale, including
 * why this isn't instead a nested array field on the aggregate entries.
 *
 * In-memory only, no persistence, same pattern as every other store in this
 * phase. There is no split-expenses API yet.
 *
 * Item shape:
 * {
 *   id: string,                        // `split-${Date.now()}`
 *   title: string,
 *   category: string,
 *   iconName: string,
 *   glyph: string,
 *   tone: string,
 *   date: string,                      // YYYY-MM-DD, same convention as useTransactionsStore
 *   amount: number,                    // total expense amount
 *   splitMode: 'individual' | 'group',
 *   individualId: string | null,       // references a useIndividualSplitsStore entry id —
 *                                       // non-null iff splitMode === 'individual'
 *   groupId: string | null,            // references a useGroupsStore group id —
 *                                       // non-null iff splitMode === 'group'
 *   splitMethod: 'equally' | 'unequally' | 'percentage' | 'shares' | 'adjustment',
 *   paidById: string,                  // 'self', or a contactId / memberContactId
 *   participants: [
 *     { participantId: string, name: string, amount: number },
 *     // participantId is 'self' | contactId/memberContactId; amounts sum
 *     // exactly to `amount`.
 *   ],
 *   addedToPersonalExpenses: boolean,      // whether the §3.5 checkbox was checked at save time
 *   personalTransactionId: string | null,  // the useTransactionsStore id it created,
 *                                           // if addedToPersonalExpenses; null otherwise
 * }
 */
export const useSplitExpensesStore = create((set) => ({
  splitExpenses: [],

  /**
   * Prepends a newly saved split expense record — mirrors every existing
   * store's "newest first" convention (useTransactionsStore.addTransaction,
   * useGroupsStore.addGroup).
   * @param {object} splitExpense
   */
  addSplitExpense: (splitExpense) =>
    set((state) => ({ splitExpenses: [splitExpense, ...state.splitExpenses] })),
}));
