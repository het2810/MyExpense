import { create } from 'zustand';
import * as transactionsApi from '../api/transactionsApi';
import { getErrorMessage, isSessionTerminalError } from '../api/errorMessages';
import { getSessionEpoch, registerSignOutReset } from './signOutReset';

/**
 * One category's transactions for one date range — the Statistics tab's
 * drill-down, server-backed by `GET /api/v1/transactions?categoryId=&dateFrom=
 * &dateTo=` (docs/api/api-overview.md §4.1).
 *
 * **No new endpoint, and that is the design** (§14.1,
 * docs/decisions/0022-statistics-expenses-by-parent-category.md §6): §4.1
 * already filters by category **with the parent -> subcategory roll-up built
 * in**, is already paginated, already owner-scoped and already returns every
 * display field a row needs. A `/statistics/categories/{id}/transactions`
 * would duplicate pagination, filtering, the DTO and the roll-up to deliver
 * information that already exists.
 *
 * Layering: stores may import `src/api/*`; screens may not (ADR 0016 §1).
 * Every call goes through `transactionsApi`, i.e. through
 * `apiClient.authorizedRequest`.
 *
 * ---
 * **WHY THIS IS NOT `useTransactionsStore`.**
 *
 * That store holds the Dashboard's own unfiltered page-0-onwards list, and the
 * Dashboard's derived figures and its `loadMore` page arithmetic are computed
 * over it. Pointing it at a filtered query would silently change what the
 * Dashboard is summing. So the drill-down gets its own small, single-query
 * store, and the transactions domain's store is left exactly as it is.
 *
 * ---
 * **THIS STORE OWNS A LIST. IT OWNS NO TOTAL.**
 *
 * The rule, stated in §14.1 and in ADR 0022 §6 rather than invented here:
 * **§14 owns every total; `GET /transactions` owns every list.** So nothing
 * here or above it sums `transactions` to produce a figure — the category's
 * amount on the drill-down header is the one §14 already answered and the
 * screen was already holding, and the row count is `totalElements` from this
 * same `PageResponse` (which is why §14 carries no `transactionCount`).
 * Summing a page would be understated by construction the moment there is more
 * than one page, which is the same error the category-delete pre-flight
 * rejected (§3.5).
 *
 * ---
 * **ONE QUERY AT A TIME, KEYED BY ITS THREE PARAMETERS.**
 *
 * `categoryId`/`dateFrom`/`dateTo` record which query the held rows answer. A
 * request for a different one clears the rows before it fetches, so one
 * category's transactions can never be read under another's heading, and
 * opening a second category never flashes the first's rows.
 *
 * ---
 * **RESET ON SIGN-OUT.** Registered with signOutReset.js like every other
 * per-account cache: these are one account's transactions.
 */

const INITIAL_STATE = {
  /** @type {string | null} The category the held rows are filtered to. */
  categoryId: null,
  /** @type {string | null} Inclusive `dateFrom` the held rows are filtered to. */
  dateFrom: null,
  /** @type {string | null} Inclusive `dateTo` the held rows are filtered to. */
  dateTo: null,

  /**
   * @type {object[]} `TransactionResponse[]` for this query, in the server's
   * order, one or more pages deep. Held verbatim with the API's own field names
   * (constitution §15/§30), exactly as `useTransactionsStore` holds them.
   */
  transactions: [],

  /** Highest page index successfully loaded; -1 when nothing is loaded yet. */
  loadedPage: -1,
  /** From the last `PageResponse` — `loadedPage + 1 < totalPages` means more. */
  totalPages: 0,
  /**
   * From the last `PageResponse`. **The query's true row count, not the loaded
   * one** — this is the drill-down's "N transactions", and the reason §14 needs
   * no count field of its own (§14.1).
   */
  totalElements: 0,

  /** The page-0 read is in flight. */
  isLoading: false,
  /** A next-page read is in flight. */
  isLoadingMore: false,
  /** True once a page-0 read has succeeded for the current query. */
  hasLoaded: false,
  /** User-facing copy for a failed page-0 read (constitution §22), or null. */
  loadError: null,
  /**
   * User-facing copy for a failed *next-page* read. Kept apart from
   * `loadError` for the reason `useTransactionsStore` records: a failed first
   * page replaces the list with a retry, while a failed next page leaves a
   * perfectly good list on screen and must not blank it.
   */
  loadMoreError: null,
};

/**
 * The minimum a drill-down row needs to be keyed and rendered: an id, a title,
 * a numeric amount, and the two snapshot fields the row composes
 * unconditionally.
 *
 * **A smaller predicate than `useTransactionsStore`'s, deliberately.** That
 * one also requires `version`, because its rows are editable and `version` is
 * sent back on a `PATCH` (§4.4). These rows are read-only — this screen
 * renders them and nothing more — so requiring a field no consumer here uses
 * would reject a perfectly renderable row.
 *
 * `httpClient` already normalizes unparseable JSON, but an empty `200` body
 * resolves to `null` (ADR 0016 §3.1) and a proxy or captive portal can hand
 * back something else entirely — neither may reach a `.toLocaleString()` in a
 * screen.
 *
 * @param {unknown} entry
 * @returns {boolean}
 */
function isTransactionRow(entry) {
  return (
    Boolean(entry) &&
    typeof entry.id === 'string' &&
    typeof entry.title === 'string' &&
    Number.isFinite(entry.amount) &&
    typeof entry.categoryName === 'string' &&
    typeof entry.txnDate === 'string'
  );
}

/**
 * Validates one `PageResponse<TransactionResponse>` (api-overview.md's "Common
 * types") and fills the present-but-null keys this screen reads, so no row
 * renderer has to defend against their absence.
 *
 * **§4.3's three detail-only fields are not stripped here, because they cannot
 * arrive here**: `receiptSignedUrl`/`paymentMethodDisplay`/
 * `paymentMethodUpiId` exist only on the single-resource read (§4.1, ADR 0020
 * §5.2), and this store calls the list endpoint and nothing else.
 *
 * Nothing is renamed, reshaped or re-sorted (constitution §15/§30) — §4.1's
 * order is the server's.
 *
 * @param {unknown} response
 * @returns {{ content: object[], page: number, totalPages: number,
 *   totalElements: number } | null}
 */
function toTransactionPage(response) {
  if (!response || !Array.isArray(response.content)) {
    return null;
  }
  if (!response.content.every(isTransactionRow)) {
    return null;
  }
  return {
    content: response.content.map((transaction) => ({
      ...transaction,
      categoryId: transaction.categoryId ?? null,
      parentCategoryName: transaction.parentCategoryName ?? null,
      groupId: transaction.groupId ?? null,
      splitExpenseId: transaction.splitExpenseId ?? null,
    })),
    page: Number.isInteger(response.page) ? response.page : 0,
    totalPages: Number.isInteger(response.totalPages) ? response.totalPages : 1,
    totalElements: Number.isInteger(response.totalElements)
      ? response.totalElements
      : response.content.length,
  };
}

/**
 * Appends a page, dropping any id already held — the same dedupe
 * `useTransactionsStore` performs and for the same reason: pagination is an
 * offset into a list that can change underneath it, and a duplicate `key` in a
 * `FlatList` is a visible React warning rather than a silent one.
 *
 * @param {object[]} held
 * @param {object[]} incoming
 * @returns {object[]}
 */
function appendPage(held, incoming) {
  const heldIds = new Set(held.map((transaction) => transaction.id));
  return [...held, ...incoming.filter((transaction) => !heldIds.has(transaction.id))];
}

/**
 * True when the session changed while a request was in flight, meaning its
 * answer belongs to an account that is no longer signed in and must be
 * discarded rather than written into state (see signOutReset.js).
 *
 * Returning without clearing the in-flight flag is deliberate and safe: the
 * sign-out reset has already restored INITIAL_STATE, flags included.
 *
 * @param {number} epochAtStart
 * @returns {boolean}
 */
function hasSessionChanged(epochAtStart) {
  return getSessionEpoch() !== epochAtStart;
}

export const useCategoryTransactionsStore = create((set, get) => ({
  ...INITIAL_STATE,

  /**
   * Reads page 0 of `GET /transactions?categoryId=&dateFrom=&dateTo=` (§4.1).
   *
   * Cache-first **for the same three parameters**, so re-opening the same
   * category within a session is free; a different category or a different
   * range clears the held rows first. `{ force: true }` is the explicit retry.
   *
   * **A top-level `categoryId` rolls up over its subcategories, server-side**
   * (§4.1, ADR 0019 §5) — which is exactly why the drill-down agrees with the
   * breakdown's rolled-up `amount` without this client doing anything. A
   * subcategory id matches that subcategory alone, which is what makes an
   * expanded child row tappable too.
   *
   * **It never matches an income row** (§4.1): an income transaction has no
   * category at all. That is the same structural exclusion §14 relies on, so
   * the drill-down cannot contradict the expenses-only breakdown above it.
   *
   * @param {{ categoryId: string, dateFrom?: string | null,
   *   dateTo?: string | null, force?: boolean }} options
   * @returns {Promise<void>}
   */
  loadCategoryTransactions: async ({ categoryId, dateFrom = null, dateTo = null, force = false }) => {
    if (!categoryId) {
      return;
    }
    const state = get();
    if (state.isLoading) {
      return;
    }
    const isSameQuery =
      state.categoryId === categoryId && state.dateFrom === dateFrom && state.dateTo === dateTo;
    if (state.hasLoaded && isSameQuery && !force) {
      return;
    }

    const epochAtStart = getSessionEpoch();
    set(
      isSameQuery
        ? { isLoading: true, loadError: null, loadMoreError: null }
        : { ...INITIAL_STATE, categoryId, dateFrom, dateTo, isLoading: true },
    );

    try {
      const response = await transactionsApi.listTransactions({
        categoryId,
        dateFrom,
        dateTo,
        page: 0,
      });
      if (hasSessionChanged(epochAtStart)) {
        return;
      }
      const page = toTransactionPage(response);
      if (!page) {
        throw new Error('The transactions response did not match the contract.');
      }
      set({
        categoryId,
        dateFrom,
        dateTo,
        transactions: page.content,
        loadedPage: page.page,
        totalPages: page.totalPages,
        totalElements: page.totalElements,
        isLoading: false,
        hasLoaded: true,
        loadError: null,
      });
    } catch (error) {
      if (hasSessionChanged(epochAtStart)) {
        return;
      }
      // `hasLoaded` stays false, so the screen shows the failure with a Retry
      // instead of an empty list that reads as "you spent nothing in this
      // category" (constitution §22). A terminal 401 shows nothing: the
      // session is already gone and this store is about to be reset.
      set({
        isLoading: false,
        loadError: isSessionTerminalError(error) ? null : getErrorMessage(error),
      });
    }
  },

  /**
   * Appends the next page of the current query, if there is one. Driven by the
   * drill-down list reaching its end; a no-op while any read is in flight,
   * when nothing has loaded yet, or when the last page is already held — so a
   * fast scroll cannot stack up requests.
   *
   * On failure the held rows stay exactly as they are and the message goes to
   * `loadMoreError`.
   *
   * @returns {Promise<void>}
   */
  loadMoreCategoryTransactions: async () => {
    const state = get();
    if (state.isLoading || state.isLoadingMore || !state.hasLoaded || !state.categoryId) {
      return;
    }
    const nextPage = state.loadedPage + 1;
    if (nextPage >= state.totalPages) {
      return;
    }

    const { categoryId, dateFrom, dateTo } = state;
    const epochAtStart = getSessionEpoch();
    set({ isLoadingMore: true, loadMoreError: null });

    try {
      const response = await transactionsApi.listTransactions({
        categoryId,
        dateFrom,
        dateTo,
        page: nextPage,
      });
      if (hasSessionChanged(epochAtStart)) {
        return;
      }
      const page = toTransactionPage(response);
      if (!page) {
        throw new Error('The transactions response did not match the contract.');
      }
      set((current) => {
        // The query changed underneath this request (the user went back and
        // opened another category). Its answer describes a list nobody is
        // looking at, so it is discarded rather than appended to a different
        // category's rows — the same reasoning as the session-epoch guard, one
        // scope down. Leaving the flags alone is safe for the same reason it is
        // there: a query change goes through INITIAL_STATE, which has already
        // cleared `isLoadingMore`.
        if (
          current.categoryId !== categoryId ||
          current.dateFrom !== dateFrom ||
          current.dateTo !== dateTo
        ) {
          return {};
        }
        return {
          transactions: appendPage(current.transactions, page.content),
          // The server's own `page` is trusted over the requested one, so a
          // clamped or shifted answer cannot make this counter drift.
          loadedPage: page.page,
          totalPages: page.totalPages,
          totalElements: page.totalElements,
          isLoadingMore: false,
          loadMoreError: null,
        };
      });
    } catch (error) {
      if (hasSessionChanged(epochAtStart)) {
        return;
      }
      set({
        isLoadingMore: false,
        loadMoreError: isSessionTerminalError(error) ? null : getErrorMessage(error),
      });
    }
  },

  /** Drops this account's drill-down rows — see signOutReset.js. */
  resetCategoryTransactions: () => set({ ...INITIAL_STATE }),
}));

registerSignOutReset(() => {
  useCategoryTransactionsStore.getState().resetCategoryTransactions();
});
