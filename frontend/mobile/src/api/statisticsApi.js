import { authorizedRequest } from './apiClient';
import { STATISTICS_PATHS } from './config';

/**
 * Statistics — one thin function per wired endpoint, the exact shape
 * authApi.js established and usersApi.js/categoriesApi.js/transactionsApi.js
 * already follow (docs/decisions/0016-frontend-api-integration.md §3.4).
 * Contract: docs/api/api-overview.md §14.1, designed by
 * docs/decisions/0022-statistics-expenses-by-parent-category.md.
 *
 * **The call goes through `apiClient.authorizedRequest`.** §14 requires
 * `Authorization: Bearer <accessToken>` and is owner-scoped from the JWT
 * principal, so `sendRequest` is never used directly and raw `fetch` never
 * appears: going through `authorizedRequest` is what attaches the bearer and
 * gets the single-flight refresh-on-401, the stale-token comparison and the
 * forced logout on a terminal 401 (ADR 0016 §6.2/§6.3). None of that may be
 * re-implemented or worked around here.
 *
 * This function returns the parsed response and throws `ApiError` on any
 * failure. It holds no state and touches no store: that is what lets React
 * Query wrap it as a `queryFn` later without this layer changing (ADR 0016
 * §10).
 *
 * Layer rule (ADR 0016 §1): may import `apiClient` and `config`. Never React,
 * never a store.
 *
 * ---
 * **THERE IS ONE FUNCTION HERE, AND THE DRILL-DOWN IS NOT IT.**
 *
 * Tapping a category calls `transactionsApi.listTransactions({ categoryId,
 * dateFrom, dateTo })` — §4.1, which already filters by category **with the
 * parent -> subcategory roll-up built in**, is already paginated and already
 * returns every display field a row needs (ADR 0022 §6). So no
 * `listCategoryTransactions` wrapper belongs in this module: it would be a
 * second name for a request `transactionsApi` already makes.
 *
 * The split of responsibility that follows from it is a rule, not a
 * convenience: **§14 owns every total; `GET /transactions` owns every list.**
 * Nothing in this app may sum a transactions page to produce a figure §14
 * already states — including a subcategory's own amount, which is why §14
 * carries the per-child amounts at all.
 */

/**
 * Builds a query string from the subset of §14.1's parameters a caller
 * actually supplied. `undefined` and `null` are dropped rather than sent as
 * empty values: `?dateFrom=` is not the same request as no `dateFrom` at all,
 * and the server validates both dates (so a blank would be a `400
 * VALIDATION_ERROR`).
 *
 * **A deliberate four-line copy of transactionsApi.js's private helper, not a
 * shared import.** ADR 0016 §1's module table gives each endpoint module
 * `apiClient` + `config` as its imports; an endpoint module importing another
 * endpoint module is not a shape that table describes, and promoting a
 * four-line string builder into a sixth api/ file to avoid it would cost more
 * than it saves (constitution §25 — duplicate once is acceptable).
 *
 * @param {object} params
 * @returns {string} '' or '?a=1&b=2'
 */
function buildQuery(params) {
  const pairs = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null)
    .map(([key, value]) => `${key}=${encodeURIComponent(String(value))}`);
  return pairs.length > 0 ? `?${pairs.join('&')}` : '';
}

/**
 * `GET /api/v1/statistics/categories` -> `200 CategoryStatisticsResponse`
 * (api-overview.md §14.1):
 * `{ dateFrom, dateTo, totalSpent, categories: [{ categoryId, categoryName,
 *    iconName, glyph, amount, subcategories: [...] }] }`.
 *
 * Five properties of this response are worth knowing at the call site, because
 * each one removes work a client might otherwise invent:
 *
 * - **Expenses only, and not by a filter.** There is no `type` parameter and
 *   no income equivalent anywhere under `/statistics` (ADR 0022 §1). Income
 *   rows carry `categoryId: null` and cannot join to a category at all.
 * - **`dateFrom`/`dateTo` are optional, inclusive bounds on `txnDate`**,
 *   `YYYY-MM-DD`, with the same two names and the same semantics as §4.1's.
 *   Omitting both means all of the caller's history. `dateFrom > dateTo` is a
 *   `400 VALIDATION_ERROR`. **There is no `budgetPeriodId`** — a client that
 *   wants its budget period passes that period's own `startDate`/`endDate`.
 * - **`categories[]` holds TOP-LEVEL entries only**, each with its rolled-up
 *   `amount` and its own `subcategories[]`. A parent's `amount` includes its
 *   children's; the parent's own direct spend is `amount` minus the sum of the
 *   children and is deliberately not a field.
 * - **Ordering is part of the contract** — `amount` descending, ties by
 *   `categoryName` ascending, at both levels. The client never re-sorts: a
 *   second sort that disagreed with the server would reshuffle the list
 *   between two identical requests.
 * - **No `percentage` field and no `transactionCount` field.** Percentages are
 *   `amount / totalSpent`, computed client-side in exactly one place
 *   (`utils/statistics.js`), and `totalSpent` is guaranteed to equal the sum of
 *   `categories[].amount` so the division is always well-defined. A row count
 *   is `totalElements` on the §4.1 drill-down the screen is already making.
 *
 * **Zero spend is a `200`**, `{ totalSpent: 0.00, categories: [] }` — never a
 * `404` and never an empty body (§14.1, ADR 0022 §5). It is not analogous to
 * `GET /budget/active-period`'s `404 NO_ACTIVE_PERIOD`: there a resource does
 * not exist, here a computation over an empty set returned zero. The caller
 * renders its own empty state.
 *
 * **No premium gate** — `403 PREMIUM_REQUIRED` is not a valid response from
 * this endpoint (ADR 0022 §7), so nothing here or above it checks entitlement.
 *
 * Errors: `400 VALIDATION_ERROR` (a malformed date, or `dateFrom` after
 * `dateTo`), `401` (handled by `authorizedRequest`), `429
 * RATE_LIMIT_EXCEEDED` — all mapped to copy in errorMessages.js.
 *
 * @param {{ dateFrom?: string | null, dateTo?: string | null }} [range]
 *   Both optional; `null`/`undefined` is omitted from the query string.
 * @returns {Promise<object>} CategoryStatisticsResponse
 */
export function getCategoryStatistics({ dateFrom, dateTo } = {}) {
  return authorizedRequest(`${STATISTICS_PATHS.categories}${buildQuery({ dateFrom, dateTo })}`);
}
