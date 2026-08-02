import { create } from 'zustand';
import * as activitiesApi from '../api/activitiesApi';
import { getErrorMessage, isSessionTerminalError } from '../api/errorMessages';
import { bindStorePersistence } from '../offline/persistence';
import { CACHE_CAPS } from '../offline/config';
import { getSessionEpoch, registerSignOutReset } from './signOutReset';
import {
  CACHE_CONTRACT_STATE,
  keepsSnapshotOnFailure,
  nowIso,
  shouldFetch,
} from './offlineStoreSupport';

/**
 * The signed-in account's activity feed — server-backed by
 * `GET /api/v1/activities` (docs/api/api-overview.md §11.1), implemented per
 * `backend/README.md` §17. Backs the global Activities screen, reached from
 * Profile.
 *
 * Until now that screen rendered `useActivityLogStore`, a purely local store
 * the app wrote into itself on four events. **Three of those four now have a
 * real server-side writer** (the fan-out that runs in the same transaction as a
 * split save or a settlement), so the client no longer composes them: an entry
 * minted on this device would sit beside server entries looking identical,
 * would not exist on any other device, and would double-count the events the
 * backend already records. §11 has no write endpoint at all — `activities` rows
 * are immutable and produced only by the server (`backend/README.md` §17's
 * opening block) — so this store **only ever reads**.
 *
 * Layering: stores may import `src/api/*`; screens may not (ADR 0016 §1).
 * Every call goes through `activitiesApi`, i.e. through
 * `apiClient.authorizedRequest`. The orchestration (guard -> request -> state)
 * lives here, never in a screen (constitution §8).
 *
 * ---
 * **SHAPE: `ActivityResponse`, HELD VERBATIM.**
 *
 * Every row is one §11.1 `ActivityResponse`, with the API's own field names and
 * nothing renamed or reshaped (constitution §15/§30), exactly as
 * `useTransactionsStore` holds `TransactionResponse`:
 *
 *   { id, type, activityDate, activityTime, descriptionPrefix, entityName,
 *     descriptionSuffix, relatedTransactionId, relatedGroupId,
 *     relatedContactId, relatedSplitExpenseId, iconName, glyph, tone,
 *     createdAt }
 *
 * Note `activityDate`/`activityTime` rather than the old local store's
 * `date`/`time`: `ActivityLogItem` renders the contract's names, which is what
 * keeps one row component serving this feed without a translation layer in the
 * middle.
 *
 * **`descriptionSuffix: ""` is normal and must not be treated as missing.** It
 * is empty on every entry whose `entityName` is `null`, and
 * `descriptionPrefix` is then the complete sentence (`backend/README.md`
 * §17.1 point 4, §17.10). All four `related_*` ids may be `null` and a row
 * must render anyway.
 *
 * **`type`, `glyph` and `tone` are server values from an extensible union with
 * no vocabulary check** (§17.8 flag 7), so nothing here switches exhaustively
 * on any of them — an unknown `tone` falls through to `IconBadge`'s own
 * default.
 *
 * ---
 * **ORDER IS THE SERVER'S. NOTHING HERE RE-SORTS, AND THAT IS NOT A STYLE
 * CHOICE.**
 *
 * The server orders by `activityDate` desc, `activityTime` desc, `id` desc,
 * with `createdAt` in no `ORDER BY` (§17.1/§17.7 note 2). **One fan-out writes
 * several rows from a single computed instant**, so two rows sharing a date
 * *and* a time is the normal case rather than an edge case — the `id`
 * tie-break is what makes the order total, and a total order is what makes
 * offset pagination stable. A client-side re-sort, even on the same two fields,
 * would not reproduce that tie-break, so it would disagree with the server
 * about which rows belong to which page: the user would see one entry twice and
 * another not at all (§17.2).
 *
 * ---
 * **PAGINATION: PAGES ARE ACCUMULATED INTO ONE FLAT, NEWEST-FIRST ARRAY.**
 *
 * §11.1 answers a `PageResponse`, 20 rows at a time. The screen renders a flat
 * list, so this store keeps one: page 0 is read by `loadActivities`, and
 * `loadMoreActivities` appends the next page as the list scrolls — the same
 * accumulate-and-dedupe arrangement `useTransactionsStore` uses, including the
 * separation of `loadError` from `loadMoreError` (a failed next page must never
 * blank a list the user is already reading).
 *
 * Offset pagination over a log that only ever grows is sound at this scale;
 * `backend/README.md` §17.8 flag 2 records that keyset pagination becomes a
 * question only once a feed reaches the thousands.
 *
 * ---
 * **EXPECT A THIN FEED, AND DO NOT PAD IT.**
 *
 * Of §11's four documented types, **only `split_saved` and `settlement` have a
 * writer anywhere in the backend**; `group_created` and `transaction_edited`
 * can never appear in this response (§17.8 flag 8, §17.10). An unregistered
 * contact has no `users` row to receive a fan-out, so a group of four can
 * legitimately produce three rows (flag 9). This store therefore holds exactly
 * what arrived and seeds, pads or synthesises nothing — `hasLoaded` is what
 * distinguishes "there is genuinely no activity" from "nothing is known yet",
 * and the screen renders a failure with a Retry rather than an empty state when
 * the read failed (constitution §22).
 *
 * ---
 * **WHAT RESETS ON SIGN-OUT, AND WHY IT ISN'T OPTIONAL.**
 *
 * These rows are one account's own audit trail, and their sentences contain
 * real amounts and real counterparts' names. They are registered with
 * `signOutReset.js` and every request is epoch-guarded, exactly as
 * `useTransactionsStore`/`useStatisticsStore` already are. Without it, signing
 * out and in as another account would render the previous user's history — and
 * because the loader is cache-first, a `GET /activities` still in flight when
 * Log Out is tapped would write those rows straight back into a store that had
 * just been cleared, where they would then be *skipped over* rather than
 * refetched for the whole next session.
 */

const INITIAL_STATE = {
  /**
   * @type {object[]} `ActivityResponse[]`, server-ordered, one or more pages
   * deep. Empty until a read succeeds — deliberately, rather than seeded: a
   * placeholder entry would be a claim about something the user did.
   */
  activities: [],

  /** Highest page index successfully loaded; -1 when nothing is loaded yet. */
  loadedPage: -1,
  /** From the last `PageResponse` — `loadedPage + 1 < totalPages` means more. */
  totalPages: 0,
  /** From the last `PageResponse`. The account's true entry count, not the loaded one. */
  totalElements: 0,

  /** The page-0 read is in flight. */
  isLoading: false,
  /** A `loadMoreActivities` read is in flight. */
  isLoadingMore: false,
  /** True once a page-0 read has succeeded — i.e. `activities` is the server's. */
  hasLoaded: false,
  /** User-facing copy for a failed page-0 read (constitution §22), or null. */
  loadError: null,
  /**
   * User-facing copy for a failed *next-page* read. Kept apart from
   * `loadError` because the two need opposite treatment: a failed first page
   * replaces the list with a retry, while a failed next page leaves a perfectly
   * good list on screen and must not blank it.
   */
  loadMoreError: null,
  ...CACHE_CONTRACT_STATE,
};

/**
 * The minimum one entry needs to be keyed and rendered: an id, the two fields
 * the timestamp line is composed from, and a prefix string.
 *
 * `descriptionPrefix` is required to be a **string** but is deliberately
 * allowed to be `''` — on a "they paid you" entry the counterpart's name opens
 * the sentence and the prefix can legitimately be empty, exactly as
 * `descriptionSuffix` is empty whenever `entityName` is null
 * (`backend/README.md` §17.1 point 4). A truthiness check here would reject a
 * valid row.
 *
 * `glyph`/`tone`/`iconName` are **not** required: they are display values from
 * an extensible, unchecked union, and a missing one costs a badge tint rather
 * than a wrong statement (`IconBadge` has its own default).
 *
 * `httpClient` already normalizes unparseable JSON, but an empty `200` body
 * resolves to `null` (ADR 0016 §3.1) and a proxy or captive portal can hand
 * back something else entirely — neither may reach a date formatter in a
 * screen.
 *
 * @param {unknown} entry
 * @returns {boolean}
 */
function isActivityEntry(entry) {
  return (
    entry != null &&
    typeof entry.id === 'string' &&
    entry.id.length > 0 &&
    typeof entry.activityDate === 'string' &&
    typeof entry.activityTime === 'string' &&
    typeof entry.descriptionPrefix === 'string'
  );
}

/**
 * Fills the nullable keys §11.1 guarantees are present, so no consumer has to
 * defend against their absence (the uniform-key-set convention ADR 0003 §2
 * established and §3.1 restates). Nothing is renamed, reshaped or re-ordered.
 *
 * `descriptionSuffix` defaults to `''` rather than `null` because that is what
 * the contract says an entry with no linked entity carries, and `''` is what
 * renders correctly inside the sentence.
 *
 * @param {object} activity An `ActivityResponse`.
 * @returns {object}
 */
function normalizeActivity(activity) {
  return {
    ...activity,
    entityName: activity.entityName ?? null,
    descriptionSuffix: activity.descriptionSuffix ?? '',
    relatedTransactionId: activity.relatedTransactionId ?? null,
    relatedGroupId: activity.relatedGroupId ?? null,
    relatedContactId: activity.relatedContactId ?? null,
    relatedSplitExpenseId: activity.relatedSplitExpenseId ?? null,
    // Additive (ADR 0027 §6.5): the change-log row this entry explains, which
    // the feed opens as Change Detail. Null for entries without one.
    relatedChangeLogId: activity.relatedChangeLogId ?? null,
    iconName: activity.iconName ?? null,
    glyph: activity.glyph ?? null,
    tone: activity.tone ?? null,
  };
}

/**
 * Validates one `PageResponse<ActivityResponse>` (api-overview.md's "Common
 * types"). Returns the page, or `null` when the response is not one at all —
 * which the caller turns into the generic failure copy.
 *
 * **The entries keep the server's order.** This function maps and nothing else;
 * there is no `sort` here and there must never be one.
 *
 * @param {unknown} response
 * @returns {{ content: object[], page: number, totalPages: number, totalElements: number } | null}
 */
function toActivityPage(response) {
  if (!response || !Array.isArray(response.content)) {
    return null;
  }
  if (!response.content.every(isActivityEntry)) {
    return null;
  }
  return {
    content: response.content.map(normalizeActivity),
    page: Number.isInteger(response.page) ? response.page : 0,
    totalPages: Number.isInteger(response.totalPages) ? response.totalPages : 1,
    totalElements: Number.isInteger(response.totalElements)
      ? response.totalElements
      : response.content.length,
  };
}

/**
 * Appends a page, dropping any id already held.
 *
 * **The dedupe is not defensive clutter**, and it matters more here than on the
 * transactions list: offset pagination is an index into a list that grows
 * underneath it, and this list grows from *other members' actions* as well as
 * the user's own. A split another member saves while page 1 is loaded shifts
 * every later row one position, so the next page would otherwise repeat a row
 * already on screen — and a duplicate `key` in a `FlatList` is a visible React
 * warning, not a silent one.
 *
 * The held copy wins over the newcomer, consistent with `useTransactionsStore`.
 * For this feed the two are identical anyway: an `activities` row is immutable,
 * so a second sighting of an id cannot carry newer content.
 *
 * @param {object[]} held
 * @param {object[]} incoming
 * @returns {object[]}
 */
function appendPage(held, incoming) {
  const heldIds = new Set(held.map((activity) => activity.id));
  return [...held, ...incoming.filter((activity) => !heldIds.has(activity.id))];
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

export const useActivitiesStore = create((set, get) => ({
  ...INITIAL_STATE,

  /**
   * Reads page 0 of `GET /activities` (§11.1), unfiltered — the global feed.
   *
   * Cache-first: a second call is a no-op once a read has succeeded, so
   * re-entering the Activities screen within a session does not spend
   * rate-limit budget. Pass `{ force: true }` for an explicit retry or a
   * refresh.
   *
   * A forced reload **discards accumulated pages and starts again at page 0**,
   * which is the only coherent thing to do: page 1 of a list that has since
   * gained entries is not page 1 of the list now on screen.
   *
   * Triggered by `useActivities()` at the point of use — never eagerly at app
   * start, which would put a network call in front of the splash gate for a
   * screen nobody has opened (the same arrangement as
   * `useCategories`/`useTransactions`).
   *
   * **No filter is passed.** §11.1's four `related_*` filters exist and combine
   * as AND, but this screen is the *global, unfiltered* feed by definition
   * (ADR 0008 §5), so sending one would be narrowing a view whose whole purpose
   * is breadth.
   *
   * @param {{ force?: boolean }} [options]
   * @returns {Promise<void>}
   */
  loadActivities: async ({ force = false } = {}) => {
    const state = get();
    if (state.isLoading) {
      return;
    }
    if (!shouldFetch(state, force)) {
      return;
    }

    const epochAtStart = getSessionEpoch();
    const fetchStartedAt = nowIso();
    set({ isLoading: true, loadError: null, loadMoreError: null });

    try {
      const response = await activitiesApi.listActivities({ page: 0 });
      if (hasSessionChanged(epochAtStart)) {
        return;
      }
      const page = toActivityPage(response);
      if (!page) {
        throw new Error('The activities response did not match the contract.');
      }
      set({
        activities: page.content,
        loadedPage: page.page,
        totalPages: page.totalPages,
        totalElements: page.totalElements,
        isLoading: false,
        hasLoaded: true,
        loadError: null,
        fetchStartedAt,
        isFromCache: false,
      });
    } catch (error) {
      if (hasSessionChanged(epochAtStart)) {
        return;
      }
      if (keepsSnapshotOnFailure(get(), error)) {
        set({ isLoading: false });
        return;
      }
      // `hasLoaded` stays false, so the screen shows the failure with a Retry
      // instead of an empty list reading "No activity yet" — which would be a
      // plain lie about an account whose request simply failed
      // (constitution §22). A non-ApiError (the throw above) maps to the
      // generic copy; a stack trace never reaches the user. A terminal 401
      // shows nothing: the session is already gone and this store is about to
      // be reset.
      set({
        isLoading: false,
        loadError: isSessionTerminalError(error) ? null : getErrorMessage(error),
      });
    }
  },

  /**
   * Appends the next page, if there is one. Driven by the Activities list
   * reaching its end; a no-op while any read is in flight, when nothing has
   * loaded yet, or when the last page is already held — so a fast scroll cannot
   * stack up requests.
   *
   * On failure the held rows stay exactly as they are and the message goes to
   * `loadMoreError`: losing a screenful of history because page 2 timed out
   * would be a worse outcome than the missing page.
   *
   * @returns {Promise<void>}
   */
  loadMoreActivities: async () => {
    const state = get();
    if (state.isLoading || state.isLoadingMore || !state.hasLoaded || state.isFromCache) {
      return;
    }
    const nextPage = state.loadedPage + 1;
    if (nextPage >= state.totalPages) {
      return;
    }

    const epochAtStart = getSessionEpoch();
    set({ isLoadingMore: true, loadMoreError: null });

    try {
      const response = await activitiesApi.listActivities({ page: nextPage });
      if (hasSessionChanged(epochAtStart)) {
        return;
      }
      const page = toActivityPage(response);
      if (!page) {
        throw new Error('The activities response did not match the contract.');
      }
      set((current) => ({
        activities: appendPage(current.activities, page.content),
        // The server's own `page` is trusted over the requested one, so a
        // clamped or shifted answer cannot make this counter drift.
        loadedPage: page.page,
        totalPages: page.totalPages,
        totalElements: page.totalElements,
        isLoadingMore: false,
        loadMoreError: null,
      }));
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

  /**
   * Drops this account's activity feed — see signOutReset.js. There is
   * deliberately no separate "clear errors" action: each operation clears its
   * own message when it starts, and sign-out clears everything.
   */
  resetActivities: () => set({ ...INITIAL_STATE }),

  /**
   * ADR 0027 §8.3/§8.8 — the cached first 100 entries render at once.
   *
   * @param {{ activities: object[], totalElements: number }} data
   * @param {string | null} fetchStartedAt
   */
  hydrateFromCache: (data, fetchStartedAt) => {
    if (!Array.isArray(data?.activities) || !data.activities.every(isActivityEntry)) {
      return;
    }
    const activities = data.activities.map(normalizeActivity);
    set({
      activities,
      loadedPage: 0,
      totalPages: 1,
      totalElements: Number.isInteger(data.totalElements) ? data.totalElements : activities.length,
      hasLoaded: true,
      isFromCache: true,
      fetchStartedAt,
      loadError: null,
      loadMoreError: null,
    });
  },
}));

registerSignOutReset(() => {
  useActivitiesStore.getState().resetActivities();
});

bindStorePersistence(useActivitiesStore, {
  storeKey: 'activities',
  watch: (state) => [state.activities],
  select: (state) => ({
    activities: state.activities.slice(0, CACHE_CAPS.activities),
    totalElements: state.totalElements,
  }),
  pull: () => useActivitiesStore.getState().loadActivities({ force: true }),
  pullOrder: 10,
});
