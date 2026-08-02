import { useMemo } from 'react';
import { useTransactionsStore } from '../store/useTransactionsStore';
import { useCategories } from './useCategories';
import { findCategoryByNamePath, toCategorySelection } from '../utils/categories';

// docs/ui/design-system.md Section 7.6 — up to 3 recent-category rows in
// AddExpenseScreen's inline CATEGORY dropdown. Still the default, and still
// that section's number; a caller that needs a different window passes one (see
// the `maxCategories` parameter below).
const MAX_RECENT_CATEGORIES = 3;

/**
 * Derives the "3 most recently used" expense categories for AddExpenseScreen's
 * inline CATEGORY dropdown, per docs/decisions/0003-payment-mode-and-date-tracking.md's
 * 2026-08-10 Amendment, Part C (data rule) and docs/ui/design-system.md
 * Section 7.6 (visual/interaction spec this feeds).
 *
 * This was deliberately a DIFFERENT list from CategoryPickerScreen's own
 * static "Recent Categories" section (ADR 0003 Amendment, "Explicit, flagged
 * divergence..."); that section has since been removed, because it filtered on
 * hardcoded `cat-*` mock ids that real server rows can never match — see
 * `categoryMocks.js`. This list is the only "recent categories" in the app
 * now, and it is the one derived from actual usage. Business logic lives here,
 * not inline in AddExpenseScreen, per constitution Section 8/25.
 *
 * It reads the categories through `useCategories()`, which makes the two
 * screens that render recents (Add Expense, Split Add Expense) load triggers
 * for `GET /categories` as well — the list is resolved against the server's
 * rows now, not a local mock, so something has to ask for them.
 *
 * Algorithm (ADR 0003 Amendment Part C, amended by
 * docs/decisions/0019-subcategories-one-optional-level.md §10.3):
 * 1. Only `type === 'expense'` transactions are considered.
 * 2. Walked in the store's existing array order, which is never re-sorted
 *    here. As of Domain 4's wiring step that order is the server's own
 *    (`GET /transactions` answers newest first, §4.1) with a just-created row
 *    prepended, so it still reads as "most recently recorded first"; no
 *    additional sort is applied (see the ADR for why sorting by date would be
 *    a worse signal here). One honest consequence of pagination: only the
 *    pages currently loaded are walked, so a category used solely on an older,
 *    not-yet-loaded page cannot appear — which is the correct answer for a
 *    "recent" list anyway.
 * 3. Unique categories are collected in that order, keyed on the
 *    **`(parentCategoryName, categoryName)` pair** rather than the bare name.
 *    *(Both are the API's own snapshot field names as of Domain 4's wiring
 *    step — the store holds `TransactionResponse` verbatim, so the leaf's name
 *    is `categoryName`, not `category`.)*
 * 4. Each pair is resolved against the live category tree — **top level and
 *    children both** — by that same pair. This is the one place a silent wrong
 *    answer was likely: with two levels a bare `Snacks` can match two
 *    different rows, so resolving on the leaf name alone would hand Add
 *    Expense a category the user never chose. A pair with no match is skipped
 *    rather than rendered broken or thrown (constitution Section 22) — and
 *    does not count toward the 3.
 * 5. **While `subcategoriesEnabled` is off, subcategory-tagged transactions
 *    are skipped**, reusing step 4's existing skip semantics rather than
 *    inventing new behaviour: nothing unselectable is offered (§6.1). Their
 *    records are untouched — this hides a row from one dropdown, it does not
 *    change any transaction.
 * 6. Stops once `maxCategories` resolved categories are collected, or the
 *    transaction list is exhausted, whichever comes first. Fewer is a valid
 *    result — callers must not pad with placeholders.
 *
 * **`maxCategories` became a parameter on 2026-11-01** so the inline dropdown
 * could ask for a wider window than it displays. It collapses a recent
 * subcategory onto its top-level parent before listing it
 * (`useCategoryQuickPicks`), and several recents can collapse onto the same
 * parent, so "the last four categories the user touched" is not always four
 * rows. Nothing about the algorithm above changes with it: it is where the walk
 * stops, not how it resolves.
 *
 * @param {number} [maxCategories] How many resolved categories to collect.
 * @returns {Array<{id: string, name: string, iconName: string, glyph: string, parentCategoryName: string | null}>}
 *   0 to `maxCategories` resolved categories, most-recently-used first, each
 *   carrying its parent's name (null at the top level) so every caller can
 *   render the full `Food › Snacks` path.
 */
export function useRecentCategories(maxCategories = MAX_RECENT_CATEGORIES) {
  const transactions = useTransactionsStore((state) => state.transactions);
  const { categories, subcategoriesEnabled } = useCategories();

  return useMemo(() => {
    const seenPairs = new Set();
    const resolvedCategories = [];

    for (const transaction of transactions) {
      if (transaction.type !== 'expense') {
        continue;
      }

      // Absent on records written before this field existed (and on every
      // income row) — normalized to null, which means "top level" everywhere.
      const parentCategoryName = transaction.parentCategoryName ?? null;

      // U+241F (unit separator) can't occur in a category name, so the pair
      // key is unambiguous — `Food › Snacks` and a category literally named
      // "Food Snacks" never collide.
      const pairKey = `${parentCategoryName ?? ''}␟${transaction.categoryName}`;
      if (seenPairs.has(pairKey)) {
        continue;
      }
      seenPairs.add(pairKey);

      if (parentCategoryName && !subcategoriesEnabled) {
        continue;
      }

      const matchedCategory = findCategoryByNamePath(
        categories,
        parentCategoryName,
        transaction.categoryName,
      );
      if (matchedCategory) {
        resolvedCategories.push(toCategorySelection(matchedCategory, parentCategoryName));
      }

      if (resolvedCategories.length >= maxCategories) {
        break;
      }
    }

    return resolvedCategories;
  }, [transactions, categories, subcategoriesEnabled, maxCategories]);
}
