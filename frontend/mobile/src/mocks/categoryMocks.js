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

// [SUPERSEDED 2026-10-23 — no consumer] CategoryPickerScreen's static
// "Recent Categories" section was this export's only reader, and it has been
// removed: `useCategoriesStore` now holds real rows from `GET /categories`
// (docs/api/api-overview.md §3.1), whose ids are server UUIDs, so an id
// filter against these `cat-*` mock strings can never match again and the
// section would have rendered empty forever.
//
// Kept here rather than deleted because the question it encodes is still open
// and was already flagged: the picker's own "recent" list was never specified
// (the [ASSUMPTION] below), and Add Expense's dropdown — a different list by
// deliberate design, docs/decisions/0003-payment-mode-and-date-tracking.md's
// Amendment Part C — already derives its three from real usage via
// useRecentCategories. If the picker should keep a Recent section it needs a
// real data source, which is a System Architect call.
//
// [ASSUMPTION] The PDF's Category Picker page (p.5) wasn't re-derivable in
// this session beyond the icon inventory already captured in
// design-system.md Section 6, so which categories should be "recent" isn't
// specified anywhere. Food/Transport/Groceries are picked as a plausible
// default since they're the most common categories already appearing in
// the seed transaction data (src/store/useTransactionsStore.js). Flagging
// for Project Owner confirmation.
export const recentCategoryIds = ['cat-food', 'cat-transport', 'cat-groceries'];
