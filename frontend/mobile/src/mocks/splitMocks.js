/**
 * MOCK DATA — locally defined placeholder data, not sourced from any API.
 * There is no backend groups/split endpoint yet; this feeds the Split
 * Groups List screen only. Replace with React Query-backed data once the
 * Backend Engineer publishes the relevant endpoints.
 *
 * NOTE: the active-groups list previously lived here as a plain exported
 * array (`activeGroups`). It has been migrated to
 * src/store/useGroupsStore.js (a Zustand store) so that creating a group
 * from the New Group modal shows up on the Split tab reactively — a plain
 * module-level array can't trigger a re-render. `splitSummary` below is not
 * appended to anywhere yet, so it stays a plain export.
 *
 * The `individualSplits` array that used to live here has also migrated —
 * to src/store/useIndividualSplitsStore.js, per
 * docs/decisions/0005-split-add-expense-flow.md §2.2 (saving a Split Add
 * Expense against a contact needs to update the Individual tab's list
 * reactively, and, for a brand-new contact relationship, create a new
 * entry — a plain module-level array can't do either). See that store for
 * the current seed data and shape.
 */

export const splitSummary = {
  totalYouOwe: 1400,
  totalYouAreOwed: 1600,
  currencySymbol: '₹',
};
