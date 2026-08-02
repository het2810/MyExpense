import { create } from 'zustand';
import * as notificationsApi from '../api/notificationsApi';
import { isApiError } from '../api/apiError';
import { getErrorMessage, isSessionTerminalError } from '../api/errorMessages';
import { bindStorePersistence } from '../offline/persistence';
import { CACHE_CAPS } from '../offline/config';
import {
  buildNotificationMarkReadOp,
  buildNotificationMarkAllReadOp,
} from '../offline/operations/notifications';
import { getSessionEpoch, registerSignOutReset } from './signOutReset';
import { useAuthStore } from './useAuthStore';
import {
  CACHE_CONTRACT_STATE,
  OFFLINE_WRITES_ENABLED,
  enqueueWrite,
  keepsSnapshotOnFailure,
  nowIso,
  shouldFetch,
} from './offlineStoreSupport';

/**
 * The signed-in account's notifications — server-backed by
 * `GET /api/v1/notifications` (docs/api/api-overview.md §12.1),
 * `PATCH /api/v1/notifications/{id}/read` (§12.2) and
 * `PATCH /api/v1/notifications/read-all` (§12.3), implemented per
 * `backend/README.md` §17. Backs the Notifications screen and the header
 * bell's unread badge.
 *
 * Until now this file held an 11-entry hand-authored mock seeded in place,
 * weighted toward unread so the badge's `9+` cap was visible on first load
 * (ADR 0012 §3). **That seed is gone, not reduced.** The real feed is thinner
 * than the mock suggested: of §12's four documented types only
 * `group_expense` and `settlement` have a writer anywhere in the backend, and
 * `overspending`/`reminder` have none at all (`backend/README.md` §17.8 flag 8,
 * §17.10). Nothing here pads, seeds or synthesises a row to close that gap, and
 * no mock row is kept alongside real ones — a notification this device invented
 * would be indistinguishable in the list and would not exist on any other
 * device.
 *
 * Layering: stores may import `src/api/*`; screens may not (ADR 0016 §1).
 * Every call goes through `notificationsApi`, i.e. through
 * `apiClient.authorizedRequest`. The orchestration (guard -> request -> state)
 * lives here, never in a screen (constitution §8).
 *
 * ---
 * **SHAPE: `NotificationResponse`, HELD VERBATIM — ALL SEVEN FIELDS.**
 *
 *   { id, type, message, notifDate, notifTime, read, createdAt }
 *
 * The API's own field names, nothing renamed or reshaped (constitution
 * §15/§30) — so `notifDate`/`notifTime`, not the old mock's `date`/`time`.
 *
 * **There are no entity ids, by design.** The row does not know which group,
 * split or settlement it describes, because `message` is the whole payload — so
 * **a notification is not navigable** and nothing may invent a tap-through by
 * parsing the sentence (`backend/README.md` §17.3, `V13` FLAG 3). Tapping a row
 * marks it read and does nothing else, which is exactly what the screen already
 * did.
 *
 * `notifTime` is the **server's** clock in UTC, not the device's (§17.8
 * flag 3). `type` is returned verbatim from an extensible union with no
 * vocabulary check, so the screen falls back to a default icon for a value it
 * does not know rather than switching exhaustively (flag 7).
 *
 * ---
 * **THE BADGE IS `totalElements`. IT IS NEVER `content.length`.**
 *
 * `unreadCount` comes from `GET /notifications?read=false&size=1` read as
 * `PageResponse.totalElements` — the account's true unread count.
 * `content.length` is capped by `size`, so it would render a 40-unread account
 * as `20`, or as `1` at this probe's page size: the badge's `9+` cap would then
 * be reporting the page parameter rather than the user's inbox.
 * `backend/README.md` §17.5 is explicit about this, and §17.10 repeats it as a
 * standing instruction to the frontend.
 *
 * **There is no unread-count endpoint and this store must not call one.**
 * `GET /notifications/unread-count` is recommended and *not built*; it is an
 * addition to §12 and therefore a System Architect ruling (§17.5, §17.8
 * flag 1). Until it exists, the probe is the contract-supported source — one
 * extra request whose discarded page is a single row.
 *
 * The count is held separately from the list and is **never derived from it**.
 * The list is paginated, so counting unread rows among the loaded pages would
 * understate the badge for exactly the accounts where the badge matters most.
 *
 * ---
 * **ORDER IS THE SERVER'S. NOTHING HERE RE-SORTS.**
 *
 * `notifDate` desc, `notifTime` desc, `id` desc, with `createdAt` in no
 * `ORDER BY` (§17.3/§17.7 note 2). One fan-out writes several rows from a
 * single instant, so ties on the date/time pair are the normal case and the
 * `id` tie-break is what makes the order total — which is what makes offset
 * pagination stable. A client re-sort would not reproduce that tie-break and
 * would disagree with the server about which rows are on which page.
 *
 * ---
 * **WHAT RESETS ON SIGN-OUT.**
 *
 * Every `message` is a rendered sentence containing a real amount and a real
 * counterpart's name, i.e. personal financial information. Registered with
 * `signOutReset.js`, and every request is epoch-guarded, exactly as
 * `useTransactionsStore`/`useStatisticsStore` are — otherwise a `GET` still in
 * flight when Log Out is tapped would write the previous account's inbox back
 * into a store that had just been cleared, and the cache-first loader would
 * then skip over it for the whole next session.
 */

const INITIAL_STATE = {
  /**
   * @type {object[]} `NotificationResponse[]`, server-ordered, one or more
   * pages deep. Both read and unread — the screen renders the distinction, it
   * does not filter on it, so the list is requested **without** the `read`
   * parameter.
   */
  notifications: [],

  /** Highest page index successfully loaded; -1 when nothing is loaded yet. */
  loadedPage: -1,
  /** From the last `PageResponse` — `loadedPage + 1 < totalPages` means more. */
  totalPages: 0,
  /** From the last `PageResponse`. The account's true row count, not the loaded one. */
  totalElements: 0,

  /**
   * @type {number} The header bell's badge: `totalElements` from
   * `?read=false&size=1`, i.e. the account's whole unread count and not a count
   * over `notifications` above. `0` until the probe succeeds —
   * `hasLoadedUnreadCount` is what distinguishes "nothing unread" from "not
   * known yet", and the bell renders no badge in either case, which is the
   * honest default for an unknown count.
   */
  unreadCount: 0,
  /** True once the unread probe has succeeded. */
  hasLoadedUnreadCount: false,
  /** The badge came from disk and has not been re-read this session (ADR 0027 §8.8). */
  isUnreadCountFromCache: false,
  ...CACHE_CONTRACT_STATE,

  /** The page-0 list read is in flight. */
  isLoading: false,
  /** A `loadMoreNotifications` read is in flight. */
  isLoadingMore: false,
  /** True once a page-0 list read has succeeded. */
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

  /** A §12.3 mark-all-read is in flight (the header action disables against it). */
  isMarkingAllRead: false,
  /**
   * User-facing copy for a failed mark-read, either one or all. One slot for
   * both: they are the same gesture from the user's point of view ("mark this
   * as handled"), only ever one is in flight at a time from this screen, and
   * the copy is shown in the same place.
   */
  markError: null,
};

/**
 * The minimum one row needs to be keyed and rendered: an id, the sentence, the
 * two fields the timestamp line is composed from, and a boolean `read` the
 * row's styling and the unread dot both depend on.
 *
 * `read` is checked as a real boolean rather than coerced: a missing or
 * stringy value would silently render every row as read, which is the one
 * mistake that makes an inbox look empty when it is not.
 *
 * `httpClient` already normalizes unparseable JSON, but an empty `200` body
 * resolves to `null` (ADR 0016 §3.1) and a proxy or captive portal can hand
 * back something else entirely.
 *
 * @param {unknown} entry
 * @returns {boolean}
 */
function isNotificationEntry(entry) {
  return (
    entry != null &&
    typeof entry.id === 'string' &&
    entry.id.length > 0 &&
    typeof entry.message === 'string' &&
    typeof entry.notifDate === 'string' &&
    typeof entry.notifTime === 'string' &&
    typeof entry.read === 'boolean'
  );
}

/**
 * Validates one `PageResponse<NotificationResponse>` (api-overview.md's "Common
 * types"). Returns the page, or `null` when the response is not one at all.
 *
 * **The entries keep the server's order** — this maps and nothing else.
 *
 * @param {unknown} response
 * @returns {{ content: object[], page: number, totalPages: number, totalElements: number } | null}
 */
function toNotificationPage(response) {
  if (!response || !Array.isArray(response.content)) {
    return null;
  }
  if (!response.content.every(isNotificationEntry)) {
    return null;
  }
  return {
    content: response.content,
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
 * Offset pagination is an index into a list that grows underneath it — and this
 * one grows from *other members' actions*, not only the user's own — so without
 * this the next page can repeat a row already on screen, and a duplicate `key`
 * in a `FlatList` is a visible React warning.
 *
 * **The held copy wins over the newcomer, and here that is load-bearing rather
 * than incidental**: the held copy may be the one this device just marked read
 * through §12.2, while a page fetched concurrently could still carry
 * `read: false`. Preferring the newcomer would make a row the user just tapped
 * spring back to unread.
 *
 * @param {object[]} held
 * @param {object[]} incoming
 * @returns {object[]}
 */
function appendPage(held, incoming) {
  const heldIds = new Set(held.map((notification) => notification.id));
  return [...held, ...incoming.filter((notification) => !heldIds.has(notification.id))];
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

/**
 * `404 NOTIFICATION_NOT_FOUND` (§12.2) — the row is gone, or it is not the
 * caller's; the contract makes those two deliberately indistinguishable, and a
 * `403` would confirm the row exists to someone who should not know
 * (`backend/README.md` §17.4(c)). Whichever it is, the held copy is a ghost and
 * is dropped.
 *
 * @param {unknown} error
 * @returns {boolean}
 */
function isNotificationGone(error) {
  return isApiError(error) && error.code === 'NOTIFICATION_NOT_FOUND';
}

/**
 * Monotonic token for the unread-badge probe, so that **only the newest probe's
 * answer is written**.
 *
 * The badge has more than one trigger — the bell mounting, every mark-one-read
 * and every mark-all-read — so two probes can legitimately be in flight at
 * once, and the one that resolves *last* is not necessarily the one that was
 * *sent* last. The case that matters is the one that would be wrong rather than
 * merely wasteful: a probe sent before a mark-all-read resolving after the one
 * sent because of it, and writing a non-zero count over the zero the server
 * just confirmed. The badge would then claim unread notifications on an inbox
 * the user had just cleared.
 *
 * This is the same device `signOutReset.sessionEpoch` uses one layer up, for
 * the same reason, and it is safe for the same reason: React Native runs one
 * single-threaded JS context, so the increment-then-compare sequence cannot be
 * interleaved. An in-flight boolean would not do — it would make a *forced*
 * refresh after a write silently skip, which is exactly the refresh that must
 * never be skipped.
 */
let unreadProbeSequence = 0;

export const useNotificationsStore = create((set, get) => ({
  ...INITIAL_STATE,

  /**
   * Reads page 0 of `GET /notifications` (§12.1) — **unfiltered**, because the
   * screen shows read and unread together and styles the difference. The
   * `read` parameter is used only by the badge probe below.
   *
   * Cache-first: a second call is a no-op once a read has succeeded. Pass
   * `{ force: true }` for an explicit retry, or after a write that the server
   * owns the result of (see `markAllNotificationsRead`).
   *
   * A forced reload **discards accumulated pages and starts again at page 0**:
   * page 1 of a list that has since changed is not page 1 of the list now on
   * screen.
   *
   * Triggered by `useNotifications()` at the point of use.
   *
   * @param {{ force?: boolean }} [options]
   * @returns {Promise<void>}
   */
  loadNotifications: async ({ force = false } = {}) => {
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
      const response = await notificationsApi.listNotifications({ page: 0 });
      if (hasSessionChanged(epochAtStart)) {
        return;
      }
      const page = toNotificationPage(response);
      if (!page) {
        throw new Error('The notifications response did not match the contract.');
      }
      set({
        notifications: page.content,
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
      // rather than "No notifications yet" — which would be a lie about an
      // account whose request simply failed (constitution §22). A terminal 401
      // shows nothing: the session is already gone and this store is about to
      // be reset.
      set({
        isLoading: false,
        loadError: isSessionTerminalError(error) ? null : getErrorMessage(error),
      });
    }
  },

  /**
   * Appends the next page, if there is one. Driven by the list reaching its
   * end; a no-op while any read is in flight, when nothing has loaded yet, or
   * when the last page is already held — so a fast scroll cannot stack up
   * requests.
   *
   * On failure the held rows stay exactly as they are and the message goes to
   * `loadMoreError`.
   *
   * @returns {Promise<void>}
   */
  loadMoreNotifications: async () => {
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
      const response = await notificationsApi.listNotifications({ page: nextPage });
      if (hasSessionChanged(epochAtStart)) {
        return;
      }
      const page = toNotificationPage(response);
      if (!page) {
        throw new Error('The notifications response did not match the contract.');
      }
      set((current) => ({
        notifications: appendPage(current.notifications, page.content),
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
   * Reads the badge: `GET /notifications?read=false&size=1` ->
   * **`PageResponse.totalElements`** (§12.1, `backend/README.md` §17.5).
   *
   * Cache-first like every other loader here, so the bell mounting on four
   * different screens (Dashboard, Split, Statistics, Profile) costs one
   * request per session rather than one per mount. `{ force: true }` is what
   * the two mark-read paths and the Notifications screen use to refresh it.
   *
   * **The probe's `content` is deliberately discarded.** It is one row, taken
   * out of order relative to the unfiltered list, and merging it would put a
   * single unread row at the head of a list it does not belong in.
   *
   * A failure leaves the previously-known count alone and records no
   * user-facing message: there is no sensible place to show "the badge could
   * not be refreshed", and a bell that keeps its last known number is better
   * than one that resets to zero and tells the user their inbox is clear
   * (constitution §22 — fail gracefully, and never fail into a false
   * statement).
   *
   * @param {{ force?: boolean }} [options]
   * @returns {Promise<void>}
   */
  loadUnreadCount: async ({ force = false } = {}) => {
    if (get().hasLoadedUnreadCount && !get().isUnreadCountFromCache && !force) {
      return;
    }

    const epochAtStart = getSessionEpoch();
    unreadProbeSequence += 1;
    const sequence = unreadProbeSequence;

    try {
      const response = await notificationsApi.getUnreadNotificationCount();
      if (hasSessionChanged(epochAtStart) || sequence !== unreadProbeSequence) {
        // Either the session ended, or a newer probe has been sent since —
        // see `unreadProbeSequence`. Discard this answer rather than write it.
        return;
      }
      if (!response || !Number.isInteger(response.totalElements)) {
        // Not the contract's `PageResponse`. The badge keeps whatever it had;
        // a `NaN` or an `undefined` must never reach the bell.
        return;
      }
      // `totalElements` — the account's whole unread count. NEVER
      // `content.length`, which is capped at `UNREAD_BADGE_PROBE_SIZE`
      // (`backend/README.md` §17.5/§17.10).
      set({
        unreadCount: Math.max(0, response.totalElements),
        hasLoadedUnreadCount: true,
        isUnreadCountFromCache: false,
      });
    } catch {
      // Intentionally silent — see the note above. There is no in-flight flag
      // to clear, which is the other thing the sequence token buys.
    }
  },

  /**
   * `PATCH /notifications/{id}/read` — tapping a row (§12.2).
   *
   * **Short-circuited when the held row is already read**, which is not an
   * optimization dressed up as one: the server itself skips the write in that
   * case, deliberately, so that `updated_at` does not move on a no-op
   * (`backend/README.md` §17.4's closing paragraph). Spending a request to be
   * told nothing changed would be the client disagreeing with that design.
   *
   * On success the held row is replaced by the **response**, not by a locally
   * patched copy: §12.2 answers the updated `NotificationResponse`, so the
   * server's own `updatedAt` and `read` are what land in state. Note what the
   * `200` does *not* prove — it does not prove a row changed, because the call
   * is idempotent; it proves only that the row is read now, which is all the UI
   * needs.
   *
   * The badge is then refreshed from the server rather than decremented here.
   * One unread row becoming read usually means `unreadCount - 1`, but
   * "usually" is not good enough for a shared inbox another member can add to
   * between two requests, and the count has exactly one authoritative source
   * (§17.5).
   *
   * A `404 NOTIFICATION_NOT_FOUND` drops the held row instead of reporting a
   * failure: the server says this id is not the caller's, so leaving it in the
   * list as a tappable ghost would be worse than silence — and the copy for
   * that code never implies a permissions problem, because the status
   * deliberately does not distinguish one (§17.4(c)).
   *
   * @param {string} id
   * @returns {Promise<{ success: boolean, error: string | null }>}
   */
  markNotificationRead: async (id) => {
    const held = get().notifications.find((notification) => notification.id === id);
    if (held && held.read) {
      return { success: true, error: null };
    }

    if (OFFLINE_WRITES_ENABLED) {
      // ADR 0027 §4.2/§8.8: naturally idempotent, queued, applied locally.
      set((current) => ({
        notifications: current.notifications.map((notification) =>
          notification.id === id ? { ...notification, read: true } : notification,
        ),
        unreadCount: Math.max(0, current.unreadCount - 1),
        markError: null,
      }));
      return enqueueWrite(buildNotificationMarkReadOp(id));
    }

    const epochAtStart = getSessionEpoch();
    set({ markError: null });

    try {
      const updated = await notificationsApi.markNotificationRead(id);
      if (hasSessionChanged(epochAtStart)) {
        return { success: false, error: null };
      }
      if (!isNotificationEntry(updated)) {
        throw new Error('The mark-read response did not match the contract.');
      }
      set((current) => ({
        notifications: current.notifications.map((notification) =>
          notification.id === id ? updated : notification,
        ),
      }));
      await get().loadUnreadCount({ force: true });
      return { success: true, error: null };
    } catch (error) {
      if (hasSessionChanged(epochAtStart)) {
        return { success: false, error: null };
      }
      if (isNotificationGone(error)) {
        // The ghost goes, and the user is told why a row vanished under their
        // finger (constitution §22 — the copy names the consequence and never
        // a permissions cause, because the `404` deliberately does not
        // distinguish one).
        get().dropNotification(id);
        const goneMessage = getErrorMessage(error);
        set({ markError: goneMessage });
        await get().loadUnreadCount({ force: true });
        return { success: false, error: goneMessage };
      }
      const message = isSessionTerminalError(error) ? null : getErrorMessage(error);
      set({ markError: message });
      return { success: false, error: message };
    }
  },

  /**
   * `PATCH /notifications/read-all` — the screen's "Mark all read" header
   * action (§12.3).
   *
   * ---
   * **THE RESPONSE IS A MESSAGE, SO BOTH THE LIST AND THE BADGE ARE RE-READ.**
   *
   * §12.3 answers `{ "message": "All notifications marked as read." }` and
   * nothing else — no rows, no affected count, no `updatedAt`. It is a bulk
   * `UPDATE` that bypasses the persistence context, and the server writes the
   * `updated_at` it sets (`backend/README.md` §17.4's `updated_at`
   * discussion). Mapping every held row to `read: true` locally would be a
   * second, guessed source of truth for a value this response does not carry,
   * and it would leave the accumulated pages holding a timestamp the server
   * never wrote. So on success this **forces a page-0 reload and forces the
   * badge probe**: the list reflects the write and the badge goes to zero
   * because the server says so, not because this function assumed it.
   *
   * The reload discarding pages 1..n is correct rather than unfortunate — after
   * a bulk write, the offsets those pages were read at describe a different
   * list.
   *
   * **Zero unread rows is still a success** (§17.4(f)): the same `200`, no
   * `404`, no `409`. The screen only offers the action while something is
   * unread, so the no-op case is not reachable from the UI, but nothing here
   * depends on that.
   *
   * @returns {Promise<{ success: boolean, error: string | null }>}
   */
  markAllNotificationsRead: async () => {
    if (get().isMarkingAllRead) {
      return { success: false, error: null };
    }

    if (OFFLINE_WRITES_ENABLED) {
      set((current) => ({
        notifications: current.notifications.map((notification) => ({
          ...notification,
          read: true,
        })),
        unreadCount: 0,
        markError: null,
      }));
      const userId = useAuthStore.getState().user?.id ?? 'me';
      return enqueueWrite(buildNotificationMarkAllReadOp(userId));
    }

    const epochAtStart = getSessionEpoch();
    set({ isMarkingAllRead: true, markError: null });

    try {
      await notificationsApi.markAllNotificationsRead();
      if (hasSessionChanged(epochAtStart)) {
        return { success: false, error: null };
      }
      set({ isMarkingAllRead: false });
      // Order is deliberate: the list first, so the rows the user is looking
      // at update before the badge they are not looking at. Both are awaited,
      // so a caller can rely on the screen being consistent when this
      // resolves.
      await get().loadNotifications({ force: true });
      await get().loadUnreadCount({ force: true });
      return { success: true, error: null };
    } catch (error) {
      if (hasSessionChanged(epochAtStart)) {
        return { success: false, error: null };
      }
      const message = isSessionTerminalError(error) ? null : getErrorMessage(error);
      set({ isMarkingAllRead: false, markError: message });
      return { success: false, error: message };
    }
  },

  /**
   * Removes one row locally. Not a delete — §12 has none; this is what "the
   * server says this id is not yours" does to held state. Kept in one place so
   * a ghost row cannot survive in one path and not another.
   *
   * @param {string} id
   */
  dropNotification: (id) =>
    set((state) => {
      const held = state.notifications.filter((notification) => notification.id !== id);
      if (held.length === state.notifications.length) {
        return {};
      }
      return {
        notifications: held,
        totalElements: Math.max(0, state.totalElements - 1),
      };
    }),

  /**
   * Drops this account's notifications and its badge — see signOutReset.js.
   *
   * There is deliberately no separate "clear errors" action: each operation
   * clears its own message when it starts (including `markError`, so tapping
   * another row *is* the dismissal), and sign-out clears everything.
   */
  resetNotifications: () => set({ ...INITIAL_STATE }),

  /**
   * ADR 0027 §8.3/§8.8 — the cached first 100 rows and the last known badge.
   *
   * @param {{ notifications: object[], totalElements: number, unreadCount: number }} data
   * @param {string | null} fetchStartedAt
   */
  hydrateFromCache: (data, fetchStartedAt) => {
    if (!Array.isArray(data?.notifications) || !data.notifications.every(isNotificationEntry)) {
      return;
    }
    const hasCount = Number.isInteger(data.unreadCount);
    set({
      notifications: data.notifications,
      loadedPage: 0,
      totalPages: 1,
      totalElements: Number.isInteger(data.totalElements)
        ? data.totalElements
        : data.notifications.length,
      unreadCount: hasCount ? Math.max(0, data.unreadCount) : 0,
      hasLoadedUnreadCount: hasCount,
      isUnreadCountFromCache: hasCount,
      hasLoaded: true,
      isFromCache: true,
      fetchStartedAt,
      loadError: null,
      loadMoreError: null,
    });
  },
}));

registerSignOutReset(() => {
  useNotificationsStore.getState().resetNotifications();
});

bindStorePersistence(useNotificationsStore, {
  storeKey: 'notifications',
  watch: (state) => [state.notifications, state.unreadCount],
  select: (state) => ({
    notifications: state.notifications.slice(0, CACHE_CAPS.notifications),
    totalElements: state.totalElements,
    unreadCount: state.unreadCount,
  }),
  pull: async () => {
    await useNotificationsStore.getState().loadNotifications({ force: true });
    await useNotificationsStore.getState().loadUnreadCount({ force: true });
  },
  pullOrder: 11,
});
