import { create } from 'zustand';
import * as statisticsApi from '../api/statisticsApi';
import { getErrorMessage, isSessionTerminalError } from '../api/errorMessages';
import { bindStorePersistence } from '../offline/persistence';
import { CACHE_CAPS } from '../offline/config';
import { getSessionEpoch, registerSignOutReset } from './signOutReset';
import { CACHE_CONTRACT_STATE, keepsSnapshotOnFailure, nowIso } from './offlineStoreSupport';

/**
 * The signed-in account's expense breakdown by parent category — server-backed
 * by `GET /api/v1/statistics/categories` (docs/api/api-overview.md §14.1),
 * designed by
 * docs/decisions/0022-statistics-expenses-by-parent-category.md. There was
 * never a mock for this: the Statistics tab is server-backed from its first
 * render.
 *
 * Layering: stores may import `src/api/*`; screens may not (ADR 0016 §1).
 * Every call goes through `statisticsApi`, i.e. through
 * `apiClient.authorizedRequest`. The orchestration (guard -> request -> state)
 * lives here, never in a screen (constitution §8), and the derivations §14
 * deliberately omits live in the pure `utils/statistics.js`.
 *
 * ---
 * **SHAPE: THE API'S NESTED BREAKDOWN, HELD VERBATIM.**
 *
 * `categories` is the response's own array: **top-level entries only**, each
 * carrying its rolled-up `amount` and its own `subcategories`, with the API's
 * field names and nothing renamed or reshaped (constitution §15/§30) — exactly
 * as `useCategoriesStore` holds `CategoryResponse` and `useTransactionsStore`
 * holds `TransactionResponse`:
 *
 *   [{ categoryId, categoryName, iconName, glyph, amount,
 *      subcategories: [{ categoryId, categoryName, iconName, glyph, amount }] }]
 *
 * Nested rather than flat, and load-bearing rather than cosmetic (§14.1, the
 * same reasoning as §3.1's tree): the bar list wants exactly the top-level
 * array and an expanded row wants exactly one entry's `subcategories`, so no
 * consumer adds a filter or a grouping pass to find the level it wants.
 *
 * **Order is the server's.** `amount` descending, ties by `categoryName`
 * ascending, at both levels — part of the contract, not incidental (§14.1).
 * Nothing in this store or above it re-sorts.
 *
 * ---
 * **THIS STORE OWNS TOTALS. IT DOES NOT OWN LISTS.**
 *
 * `totalSpent` and every `amount` here — including each subcategory's — come
 * from §14 and from nowhere else. The drill-down's rows come from
 * `GET /transactions` (§4.1) through `useCategoryTransactionsStore`, and
 * **no figure on any statistics surface may be summed from that paginated
 * list** (ADR 0022 §6: "a client must never derive a total from a paginated
 * page"). The two stores are separate for exactly that reason.
 *
 * ---
 * **EXPENSES ONLY, AND THERE IS NOTHING HERE TO TOGGLE.**
 *
 * §14 has no `type` parameter: `type = 'expense'` is a server-side invariant
 * and income is structurally unreachable, not filtered (ADR 0022 §1 — income
 * is not a category, so an income breakdown would be one 100% slice forever).
 * So this store has no `type` in its state, no income total, and nothing to add
 * one to. An income surface, if it is ever wanted, is a different endpoint with
 * a different grouping key and its own ADR.
 *
 * ---
 * **CACHED PER RANGE, AND THE RANGE IS PART OF THE IDENTITY OF THE DATA.**
 *
 * `dateFrom`/`dateTo` record which range the held figures describe. A request
 * for a *different* range does not merge into them and does not leave them on
 * screen under a new label — it clears them first (see
 * `loadCategoryStatistics`). Totals shown beside the wrong dates would be a
 * false statement about the user's money, which is the one failure mode this
 * screen cannot have.
 *
 * ---
 * **AND THE CACHE IS INVALIDATED BY A TRANSACTION WRITE** (Project Owner,
 * 2026-11-01: "after saving the expense the stats are not updated in the real
 * time it needs a refresh or refetching to update the stats").
 *
 * A breakdown is an aggregate of the account's transactions, so any confirmed
 * create/update/delete makes the held figures wrong — and because the loader is
 * cache-first, nothing would ever have asked for them again within the session.
 * `useTransactionsStore` therefore calls `invalidateCategoryStatistics` after
 * every confirmed write (see that store's
 * `invalidateStatisticsAfterTransactionWrite`, and `useCategoriesStore`'s
 * `invalidateTransactionsAfterCategoryWrite` for the pattern it mirrors). The
 * call lives inside that store rather than in the screens that save, so no
 * screen can forget it.
 *
 * **Invalidation marks; it does not fetch** — see `invalidateCategoryStatistics`
 * — and it covers the whole cache rather than one range: this store holds
 * exactly one range at a time, and any *other* range is not held at all, so a
 * step to it is already a fetch. An expense back-dated into last month
 * therefore corrects last month's chart too.
 *
 * ---
 * **RESET ON SIGN-OUT.**
 *
 * Registered with signOutReset.js like every other per-account cache. These
 * are one account's spending figures; they must not survive into another
 * session, and because the loader is cache-first a `GET /statistics/categories`
 * still in flight when Log Out is tapped would otherwise write them straight
 * back into a store that had just been cleared.
 *
 * ---
 * **OFFLINE: THIS STORE STAYS EMPTY AND SAYS SO.**
 *
 * §14 is a read-only, derived, online endpoint and is deliberately in neither
 * `/sync/push` nor `/sync/pull` (ADR 0022, Offline-first). A chart computed
 * from the local transactions cache would be the "derive a total from a page"
 * error again, so offline the tab shows its error state with a Retry and this
 * store holds nothing.
 */

const INITIAL_STATE = {
  /**
   * @type {string | null} The `dateFrom` the held figures are for, `YYYY-MM-DD`.
   * Null until a read is requested.
   */
  dateFrom: null,
  /** @type {string | null} The `dateTo` the held figures are for. */
  dateTo: null,

  /**
   * @type {number} §14.1's `totalSpent` — guaranteed to be exactly the sum of
   * `categories[].amount`, which is what makes the client-side percentages
   * well-defined (ADR 0022 §4).
   *
   * `0` until a read succeeds. **`hasLoaded` is what distinguishes "nothing was
   * spent" from "nothing is known yet"**, and the screen must not render this
   * figure before it is true: `₹0 spent` in front of a user whose request
   * failed is a lie about their finances (constitution §22).
   */
  totalSpent: 0,

  /** @type {object[]} Top-level entries, each with its own `subcategories`. */
  categories: [],

  /** The GET is in flight. */
  isLoading: false,
  /** True once a GET has succeeded — i.e. the figures above are the server's. */
  hasLoaded: false,
  /** User-facing copy for a failed GET (constitution §22), or null. */
  loadError: null,

  /**
   * @type {number} How many times a transaction write has invalidated this
   * cache this session. Monotonic; only `invalidateCategoryStatistics`
   * increments it.
   */
  invalidationCount: 0,
  /**
   * @type {number} The `invalidationCount` the **request that produced the held
   * figures started at**. Not equal to `invalidationCount` means the held
   * figures predate a write and must be re-read.
   *
   * Two counters rather than one `isStale` boolean, for one case a boolean
   * cannot express: a write confirmed *while a read was in flight*. There is no
   * request cancellation in this client (ADR 0016 §3.1), so that read is going
   * to land with pre-write figures; recording the count it *started* at makes it
   * land already marked stale, instead of clearing a flag the write had just
   * set.
   *
   * **Nothing renders this.** Staleness is a cache fact, not a screen state:
   * the tab keeps showing the last figures it successfully read — correctly
   * attributed to their range — until the re-read lands, so the four states and
   * the `hasLoaded` gate are untouched.
   */
  loadedInvalidationCount: 0,

  /**
   * Offline cache of recently read ranges (ADR 0027 §8.3: 6 ranges, LRU):
   * `{ [rangeKey]: { totalSpent, categories, fetchStartedAt, lastUsedAt } }`.
   * Offline, a cached range is shown labelled; an uncached one shows the
   * error state ("Statistics need an internet connection.").
   */
  cachedRanges: {},
  ...CACHE_CONTRACT_STATE,
};

/**
 * @param {string | null} dateFrom
 * @param {string | null} dateTo
 * @returns {string}
 */
function toRangeKey(dateFrom, dateTo) {
  return `${dateFrom ?? ''}..${dateTo ?? ''}`;
}

/**
 * @param {object} cachedRanges
 * @param {string} rangeKey
 * @param {{ totalSpent: number, categories: object[] }} statistics
 * @param {string} fetchStartedAt
 * @returns {object}
 */
function rememberRange(cachedRanges, rangeKey, statistics, fetchStartedAt) {
  const next = {
    ...cachedRanges,
    [rangeKey]: { ...statistics, fetchStartedAt, lastUsedAt: nowIso() },
  };
  const keys = Object.keys(next);
  if (keys.length <= CACHE_CAPS.statisticsRanges) {
    return next;
  }
  keys
    .sort((left, right) => next[left].lastUsedAt.localeCompare(next[right].lastUsedAt))
    .slice(0, keys.length - CACHE_CAPS.statisticsRanges)
    .forEach((key) => {
      delete next[key];
    });
  return next;
}

/**
 * The minimum one breakdown entry needs to be keyed and rendered: an id, a
 * name, and a numeric amount the screen can divide and format.
 *
 * `httpClient` already normalizes unparseable JSON, but an empty `200` body
 * resolves to `null` (ADR 0016 §3.1) and a proxy or captive portal can hand
 * back something else entirely — neither may reach a `.toLocaleString()` or a
 * division in a screen.
 *
 * `iconName`/`glyph` are **not** required: they are display values and a
 * missing one costs a badge glyph, not a correct number. The amount is what
 * must be trustworthy.
 *
 * @param {unknown} entry
 * @returns {boolean}
 */
function isBreakdownEntry(entry) {
  return (
    Boolean(entry) &&
    typeof entry.categoryId === 'string' &&
    entry.categoryId.length > 0 &&
    typeof entry.categoryName === 'string' &&
    Number.isFinite(entry.amount)
  );
}

/**
 * Validates §14.1's response and fills the two display fields that are allowed
 * to be missing, at both levels. Returns `null` when the response is not the
 * contract's shape, which the caller turns into the generic failure copy.
 *
 * **Subcategories are pinned to a flat, childless shape** — there is no third
 * level (ADR 0019 §2), so one malformed row cannot make a third level render.
 * `subcategories` is normalized to `[]` when absent rather than left
 * `undefined`: §14.1 states it is always present, and a reader that has to
 * null-guard a documented-present field is a reader that will forget.
 *
 * **Nothing is re-sorted and nothing is recomputed** — in particular
 * `totalSpent` is taken as the server states it, not summed from the entries.
 * Recomputing it here would be a second, drifting source for the one number
 * every percentage divides by (ADR 0022 §4/§6).
 *
 * **The response's `dateFrom`/`dateTo` echo is deliberately not read.** The
 * store records the range it *requested*, because that is both the cache key
 * and what the screen labels, and the two cannot disagree while this client
 * always sends both bounds. Reading the echo as well would create a second
 * source for one fact (constitution §17) and, worse, a state where the key and
 * the label differ. The one case that would make the echo informative — a
 * server that clamped or defaulted a range — §14.1 does not describe, and it
 * is listed as a flag-back in this round's report rather than quietly assumed
 * either way.
 *
 * @param {unknown} response
 * @returns {{ totalSpent: number, categories: object[] } | null}
 */
function toCategoryStatistics(response) {
  if (!response || !Number.isFinite(response.totalSpent) || !Array.isArray(response.categories)) {
    return null;
  }
  if (!response.categories.every(isBreakdownEntry)) {
    return null;
  }

  const categories = response.categories.map((entry) => ({
    ...entry,
    iconName: entry.iconName ?? null,
    glyph: entry.glyph ?? null,
    subcategories: (Array.isArray(entry.subcategories) ? entry.subcategories : [])
      .filter(isBreakdownEntry)
      .map((subcategory) => ({
        ...subcategory,
        iconName: subcategory.iconName ?? null,
        glyph: subcategory.glyph ?? null,
      })),
  }));

  return { totalSpent: response.totalSpent, categories };
}

/**
 * True when the session changed while the request was in flight, meaning its
 * answer belongs to an account that is no longer signed in and must be
 * discarded rather than written into state (see signOutReset.js — the same
 * guard `useCategoriesStore`/`useTransactionsStore` apply).
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

export const useStatisticsStore = create((set, get) => ({
  ...INITIAL_STATE,

  /**
   * Reads `GET /statistics/categories` for one inclusive date range (§14.1).
   *
   * Cache-first **for the same range**: a second call with the same two dates
   * is a no-op once a read has succeeded, so re-entering the tab within a
   * session does not spend rate-limit budget on a figure that cannot have
   * changed without a local write. Pass `{ force: true }` for an explicit
   * retry or a post-write refresh.
   *
   * **"Cannot have changed without a local write" is now enforced rather than
   * assumed**: an invalidated cache is not served (see the two invalidation
   * counters above), so the first call after a transaction write re-reads even
   * for the same range and with no `force`. That is deliberately the same
   * no-argument call the tab's focus effect already makes — the write path never
   * asks for a request, it only marks.
   *
   * **A different range clears the held figures before it fetches.** Keeping
   * last range's totals on screen under the new range's label would be a wrong
   * number with a confident caption; `hasLoaded` going back to false is what
   * makes the screen show its loading state instead.
   *
   * Triggered by `useCategoryStatistics()` at the point of use — never eagerly
   * at app start, which would put a network call in front of the splash gate
   * for a screen nobody has opened (the same arrangement as `useCategories`).
   *
   * Both dates are optional in the contract. This app always passes a range
   * (`utils/statistics.js#resolveStatisticsRange`), and `null` is omitted from
   * the query string rather than sent blank, so an all-history read remains
   * possible without a second action.
   *
   * @param {{ dateFrom?: string | null, dateTo?: string | null,
   *   force?: boolean }} [options]
   * @returns {Promise<void>}
   */
  loadCategoryStatistics: async ({ dateFrom = null, dateTo = null, force = false } = {}) => {
    const state = get();
    if (state.isLoading) {
      return;
    }
    const isSameRange = state.dateFrom === dateFrom && state.dateTo === dateTo;
    const isCacheStale = state.loadedInvalidationCount !== state.invalidationCount;
    if (state.hasLoaded && isSameRange && !force && !isCacheStale && !state.isFromCache) {
      return;
    }

    const epochAtStart = getSessionEpoch();
    const fetchStartedAt = nowIso();
    const rangeKey = toRangeKey(dateFrom, dateTo);
    const cached = state.cachedRanges[rangeKey];
    const cachedStatistics = cached ? toCategoryStatistics(cached) : null;
    if (isSameRange) {
      set({ isLoading: true, loadError: null });
    } else if (cachedStatistics) {
      // A different range already read before (ADR 0027 §8.3): shown at once,
      // attributed to its own dates, and re-read behind it.
      set({
        ...INITIAL_STATE,
        cachedRanges: state.cachedRanges,
        invalidationCount: state.invalidationCount,
        loadedInvalidationCount: state.invalidationCount,
        dateFrom,
        dateTo,
        totalSpent: cachedStatistics.totalSpent,
        categories: cachedStatistics.categories,
        hasLoaded: true,
        isFromCache: true,
        fetchStartedAt: cached.fetchStartedAt ?? null,
        isLoading: true,
      });
    } else {
      set({
        ...INITIAL_STATE,
        cachedRanges: state.cachedRanges,
        dateFrom,
        dateTo,
        isLoading: true,
      });
    }
    // Read after the set, not before: the different-range branch above restores
    // INITIAL_STATE, counters included, so the count this request starts at is
    // only knowable once that has happened.
    const invalidationCountAtStart = get().invalidationCount;

    try {
      const response = await statisticsApi.getCategoryStatistics({ dateFrom, dateTo });
      if (hasSessionChanged(epochAtStart)) {
        return;
      }
      const statistics = toCategoryStatistics(response);
      if (!statistics) {
        throw new Error('The statistics response did not match the contract.');
      }
      set((current) => ({
        totalSpent: statistics.totalSpent,
        categories: statistics.categories,
        dateFrom,
        dateTo,
        isLoading: false,
        hasLoaded: true,
        loadError: null,
        // The count this request started at, so a write confirmed while it was
        // in flight leaves these figures stale and the next load re-reads them.
        loadedInvalidationCount: invalidationCountAtStart,
        fetchStartedAt,
        isFromCache: false,
        cachedRanges: rememberRange(current.cachedRanges, rangeKey, statistics, fetchStartedAt),
      }));
    } catch (error) {
      if (hasSessionChanged(epochAtStart)) {
        return;
      }
      if (keepsSnapshotOnFailure(get(), error)) {
        set({ isLoading: false });
        return;
      }
      // `hasLoaded` stays false, so the tab shows the failure with a Retry
      // instead of an empty breakdown — which would read as "you have spent
      // nothing in this period", the most misleading thing this screen could
      // say and a statement about the user's money that is simply untrue.
      // The genuine zero case is a successful `200` with an empty array
      // (§14.1) and is a different state entirely. A non-ApiError (the throw
      // above) maps to the generic copy; a stack trace never reaches the user
      // (constitution §22). A terminal 401 shows nothing: the session is
      // already gone and this store is about to be reset.
      set({
        isLoading: false,
        loadError: isSessionTerminalError(error) ? null : getErrorMessage(error),
      });
    }
  },

  /**
   * Marks the held figures out of date, because the account's transactions have
   * changed under them. Called by `useTransactionsStore` after every confirmed
   * create/update/delete.
   *
   * **It marks and returns. It does not fetch**, and that is the decision rather
   * than an omission: most transaction writes happen on the Dashboard or in the
   * split flow, and a statistics read fired there would spend a request (and
   * rate-limit budget) on a tab the user may never open in that session. The
   * re-read happens when the Statistics tab is next shown, through the ordinary
   * cache-first `loadCategoryStatistics` call its focus effect already makes
   * (`useCategoryStatistics`) — so the refresh costs nothing until it is worth
   * something, and no screen has to remember to ask for it.
   *
   * It therefore also never sets `isLoading`, never clears `categories` and
   * never touches `hasLoaded`: a tab that happens to be mounted keeps the
   * figures it last read rather than blanking behind a spinner the user did not
   * ask for.
   *
   * **It invalidates the whole cache, not one range.** This store holds exactly
   * one range at a time and any other range is not held at all, so one counter
   * is the entire cache — an expense back-dated into a month the user steps to
   * later is read fresh either way.
   *
   * Nothing to invalidate when no read has succeeded **and none is in flight**:
   * the tab's first load will be a real request anyway, and leaving the counters
   * alone keeps "stale" meaning something. The in-flight half of that condition
   * is not symmetry for its own sake — a first read that is already on the wire
   * will land with pre-write figures, and counting the invalidation now is what
   * marks them for re-reading when it does.
   */
  invalidateCategoryStatistics: () => {
    const state = get();
    if (!state.hasLoaded && !state.isLoading) {
      return;
    }
    set({ invalidationCount: state.invalidationCount + 1 });
  },

  /**
   * Drops this account's figures — see signOutReset.js. There is deliberately
   * no separate "clear error" action: the load clears its own message when it
   * starts, and sign-out clears everything.
   */
  resetStatistics: () => set({ ...INITIAL_STATE }),

  /**
   * ADR 0027 §8.3. Only the per-range cache is restored; the tab's first
   * load serves its range from it (labelled) and re-reads behind it.
   *
   * @param {{ ranges: object }} data
   */
  hydrateFromCache: (data) => {
    if (!data || typeof data.ranges !== 'object' || data.ranges === null) {
      return;
    }
    set({ cachedRanges: data.ranges });
  },
}));

registerSignOutReset(() => {
  useStatisticsStore.getState().resetStatistics();
});

// No `pull`: statistics refresh when their screen is next opened (§8.7).
bindStorePersistence(useStatisticsStore, {
  storeKey: 'statistics',
  watch: (state) => [state.cachedRanges],
  select: (state) => ({ ranges: state.cachedRanges }),
});
