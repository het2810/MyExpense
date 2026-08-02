/**
 * The Split tab's currency symbol, and nothing else any more.
 *
 * **Everything else that lived here is now server data.** The groups list moved
 * to `src/store/useGroupsStore.js` and the individual list to
 * `src/store/useIndividualSplitsStore.js` when they became Zustand stores, and
 * as of Domain 6's wiring step both are backed by real endpoints —
 * `GET /api/v1/groups` (docs/api/api-overview.md §7.1) and
 * `GET /api/v1/splits/individuals` (§8.1).
 *
 * `totalYouOwe`/`totalYouAreOwed` are **gone**: they are derived from those two
 * lists by `utils/splitBalances.js#summarizeSplitBalances`, which is legitimate
 * because neither endpoint is paginated (a total over a complete list, not over
 * a page). A hardcoded figure beside real balances would have been the most
 * misleading thing on the screen.
 *
 * `currencySymbol` stays, and stays a constant, for the same reason
 * `src/mocks/dashboardMocks.js` still supplies one to the wired Dashboard and
 * Statistics screens: currency is a **display symbol only** this phase, and the
 * single place it appears in the whole API is
 * `UserProfileResponse.defaultCurrencyCode` (§2.1 — explicitly not on any
 * transaction, split, balance or settlement payload). Rendering it from the
 * profile needs an ISO-4217-to-symbol mapping that no document in this project
 * defines, so one constant in one place is the honest placeholder until the
 * conversion ADR lands.
 */

export const splitSummary = {
  currencySymbol: '₹',
};
