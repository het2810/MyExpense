/**
 * MOCK DATA — locally defined placeholder data, not sourced from any API.
 *
 * The `categories` array previously exported here has been promoted to
 * src/store/useCategoriesStore.js (a Zustand store), per
 * docs/decisions/0010-budget-settings.md §1 — a plain module-level array
 * can't support creating a new category reactively, and Category Picker's
 * "Add Custom" flow and Budget Settings' "Add Category" flow both need a
 * category created in either place to appear in both. Import
 * `useCategoriesStore` instead of this file's old `categories` export.
 *
 * `recentCategoryIds` stays here, unmoved — it is never mutated, so it has
 * no reason to move (same reasoning docs/decisions/
 * 0006-contact-group-search-and-split-tag.md §2 already used to leave
 * `contactsMocks.js`'s `recentContactIds` untouched).
 */

// [ASSUMPTION] The PDF's Category Picker page (p.5) wasn't re-derivable in
// this session beyond the icon inventory already captured in
// design-system.md Section 6, so which categories should be "recent" isn't
// specified anywhere. Food/Transport/Groceries are picked as a plausible
// default since they're the most common categories already appearing in
// the seed transaction data (src/store/useTransactionsStore.js). Flagging
// for Project Owner confirmation.
export const recentCategoryIds = ['cat-food', 'cat-transport', 'cat-groceries'];
