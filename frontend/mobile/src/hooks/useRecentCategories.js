import { useMemo } from 'react';
import { useTransactionsStore } from '../store/useTransactionsStore';
import { useCategoriesStore } from '../store/useCategoriesStore';

// docs/ui/design-system.md Section 7.6 — up to 3 recent-category rows in
// AddExpenseScreen's inline CATEGORY dropdown.
const MAX_RECENT_CATEGORIES = 3;

/**
 * Derives the "3 most recently used" expense categories for AddExpenseScreen's
 * inline CATEGORY dropdown, per docs/decisions/0003-payment-mode-and-date-tracking.md's
 * 2026-08-10 Amendment, Part C (data rule) and docs/ui/design-system.md
 * Section 7.6 (visual/interaction spec this feeds).
 *
 * This is deliberately a DIFFERENT list from CategoryPickerScreen's own
 * static "Recent Categories" section (categoryMocks.js's `recentCategoryIds`)
 * — that list is unchanged and out of scope for this hook (ADR 0003
 * Amendment, "Explicit, flagged divergence..."). Business logic lives here,
 * not inline in AddExpenseScreen, per constitution Section 8/25.
 *
 * Algorithm (ADR 0003 Amendment Part C):
 * 1. Only `type === 'expense'` transactions are considered.
 * 2. Walked in the store's existing array order — `addTransaction` prepends
 *    new saves to the front, so array order already IS "most recently saved
 *    first"; no additional sort by `date` is applied (see the ADR for why
 *    sorting by `date` would be a worse signal here).
 * 3. Unique `category` name values are collected in that order.
 * 4. Each collected name is resolved against useCategoriesStore's
 *    `categories` array by `name` to get its `{id, iconName, glyph}`. A name
 *    with no match is skipped rather than rendered broken or thrown
 *    (constitution Section 22) — and does not count toward the 3.
 * 5. Stops once 3 resolved categories are collected, or the transaction list
 *    is exhausted, whichever comes first. Fewer than 3 is a valid result —
 *    callers must not pad with placeholders.
 *
 * @returns {Array<{id: string, name: string, iconName: string, glyph: string}>}
 *   0-3 resolved category objects, most-recently-used first.
 */
export function useRecentCategories() {
  const transactions = useTransactionsStore((state) => state.transactions);
  const categoryDefinitions = useCategoriesStore((state) => state.categories);

  return useMemo(() => {
    const seenCategoryNames = new Set();
    const resolvedCategories = [];

    for (const transaction of transactions) {
      if (transaction.type !== 'expense') {
        continue;
      }
      if (seenCategoryNames.has(transaction.category)) {
        continue;
      }
      seenCategoryNames.add(transaction.category);

      const matchedDefinition = categoryDefinitions.find(
        (category) => category.name === transaction.category,
      );
      if (matchedDefinition) {
        resolvedCategories.push(matchedDefinition);
      }

      if (resolvedCategories.length >= MAX_RECENT_CATEGORIES) {
        break;
      }
    }

    return resolvedCategories;
  }, [transactions, categoryDefinitions]);
}
