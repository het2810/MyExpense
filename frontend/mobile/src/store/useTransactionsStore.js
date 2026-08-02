import { create } from 'zustand';
import * as transactionsApi from '../api/transactionsApi';
import { TRANSACTION_PAGE_SIZE } from '../api/config';
import { isApiError } from '../api/apiError';
import {
  getErrorMessage,
  getErrorMessageForCode,
  isSessionTerminalError,
} from '../api/errorMessages';
import {
  buildTransactionCreateRequest,
  buildTransactionUpdateRequest,
} from '../utils/transactionRequests';
import { bindStorePersistence } from '../offline/persistence';
import { getOps } from '../offline/outbox';
import { CACHE_CAPS } from '../offline/config';
import { selectActiveOps } from '../offline/overlays/activeOps';
import { overlayTransactions } from '../offline/overlays/transactions';
import {
  buildTransactionCreateOp,
  buildTransactionUpdateOp,
  buildTransactionDeleteOp,
} from '../offline/operations/transactions';
import { getSessionEpoch, registerSignOutReset } from './signOutReset';
import { useStatisticsStore } from './useStatisticsStore';
import {
  CACHE_CONTRACT_STATE,
  OFFLINE_WRITES_ENABLED,
  enqueueWrite,
  keepsSnapshotOnFailure,
  nowIso,
  shouldFetch,
} from './offlineStoreSupport';

/**
 * The signed-in account's transactions — server-backed by `GET`/`POST
 * /api/v1/transactions` and `GET`/`PATCH`/`DELETE /api/v1/transactions/{id}`
 * (docs/api/api-overview.md §4.1–§4.5) as of Domain 4's wiring step
 * (docs/roadmap/backend-build-order.md workflow step 3). Until now this held a
 * 17-entry local mock seeded in this file.
 *
 * Layering: stores may import `src/api/*`; screens may not (ADR 0016 §1).
 * Every call goes through `transactionsApi`, i.e. through
 * `apiClient.authorizedRequest`. The orchestration (guard -> request -> state)
 * lives here, never in a screen (constitution §8), and the two request bodies
 * are built by the pure `utils/transactionRequests.js`.
 *
 * ---
 * **SHAPE: `TransactionResponse`, HELD VERBATIM.**
 *
 * Every row in `transactions` is one §4.1 `TransactionResponse`, with the
 * API's own field names and nothing renamed or reshaped (constitution
 * §15/§30), exactly as `useCategoriesStore` holds `CategoryResponse`:
 *
 *   { id, clientId, title, categoryId, categoryName, parentCategoryName,
 *     categoryIconName, categoryGlyph, categoryTone, txnDate, txnTime,
 *     amount, type, scope, groupId, paymentMode, cashAmount, onlineAmount,
 *     splitExpenseId, notes, receiptPublicId, version, createdAt, updatedAt }
 *
 * This replaces the mock's own vocabulary (`category`, `date`, `time`,
 * `iconName`, `glyph`, `tone`, `receiptUri`), which is why every reader in the
 * app changed in this round. The alternative — translating the response into
 * the old names on the way in — would have been a second representation of
 * every field, and the first time the contract gained one it would have needed
 * a mapping entry nobody remembers to add.
 *
 * **The five category snapshot fields and `txnTime` are the server's.** A row
 * renders from `categoryName`/`parentCategoryName`/`categoryIconName`/
 * `categoryGlyph`/`categoryTone` directly and **never** from a category
 * lookup: they are frozen at write time (and, since
 * docs/decisions/0021-category-rename-propagates-and-misc-reassignment-on-delete.md,
 * rewritten server-side by a category rename — see "staleness" below). Income
 * rows carry `categoryId: null` with all five populated from server constants,
 * so there is no null-guard anywhere and no client-side derivation
 * (docs/decisions/0018-income-is-not-a-category.md §3).
 *
 * ---
 * **PAGINATION: PAGES ARE ACCUMULATED INTO ONE FLAT, NEWEST-FIRST ARRAY.**
 *
 * §4.1 answers a `PageResponse`, 20 rows at a time. Every consumer in this app
 * (the Dashboard list and its Personal/Group filter, `useRecentCategories`,
 * `computeSpentForPeriod`) reads a flat array, so this store keeps one: page 0
 * is read by `loadTransactions`, and `loadMoreTransactions` appends the next
 * page as the Dashboard scrolls. The server's order is newest-first and
 * deterministic, so appended pages continue the list rather than reshuffling
 * it; **nothing here ever re-sorts** (the one exception, a just-created row,
 * is documented on `createTransaction`).
 *
 * **The honest limitation, stated loudly rather than buried:** the Dashboard's
 * derived figures — `spent`, `remaining`, `DAILY AVG`, the overspend progress
 * bar and the Remaining Cash/Online breakdown — are computed over the rows
 * **currently loaded**, because there is no aggregate endpoint anywhere in §4
 * or §5. With more transactions than one page, those figures are therefore
 * *understated until the remaining pages have been loaded*. That is a real
 * correctness gap and it is flagged to the System Architect / Backend Engineer
 * in this round's report rather than papered over here with an unbounded
 * fetch-every-page loop, which would spend the rate-limit budget on every
 * Dashboard mount and still break at scale. Two clean fixes exist and both are
 * someone else's to approve: a server-side summary endpoint, or Domain 5's
 * budget wiring computing `spent` for the active period server-side.
 *
 * ---
 * **STALENESS: THESE ROWS ARE NO LONGER IMMUTABLE FOR THE SESSION.**
 *
 * Before ADR 0021 a category rename never touched a transaction, so a loaded
 * row's display fields could be cached indefinitely. That is no longer true:
 * renaming a category **rewrites the snapshot fields on its existing
 * transactions server-side**, and deleting one reassigns its transactions to
 * the protected `Misc` category. So **after any successful category mutation
 * the cache here is stale and must be refetched** —
 * `loadTransactions({ force: true })` is the hook for it (ADR 0021's
 * Frontend-Engineer follow-up 3). Nothing in the app can rename or delete a
 * category yet (`categoriesApi` exposes list and create only), which is why
 * there is no call site today; the category-management pass that adds those
 * affordances must add that call.
 *
 * ---
 * **AND A WRITE HERE INVALIDATES THE STATISTICS CACHE.**
 *
 * The Statistics tab's breakdown is an aggregate of these rows, held cache-first
 * per range by `useStatisticsStore`, so every confirmed create/update/delete
 * leaves it wrong. This store marks it stale after each one —
 * `invalidateStatisticsAfterTransactionWrite` below, the mirror of
 * `useCategoriesStore`'s `invalidateTransactionsAfterCategoryWrite`. It marks
 * only: no request is fired from a write path.
 *
 * ---
 * **WHAT RESETS ON SIGN-OUT, AND WHY IT ISN'T OPTIONAL.**
 *
 * These are one account's own financial rows, so they are registered with
 * `signOutReset.js` and every request is epoch-guarded, exactly as
 * `useProfileStore`/`useSettingsStore`/`useCategoriesStore` already are.
 * Without it, signing out and in as another account would render the previous
 * user's spending — and because the loader is cache-first, a `GET
 * /transactions` still in flight when Log Out is tapped would write those rows
 * straight back into a store that had just been cleared, where they would then
 * be *skipped over* rather than refetched for the whole next session.
 */

const INITIAL_STATE = {
  /**
   * @type {object[]} `TransactionResponse[]`, newest first, one or more pages
   * deep. Empty until a read succeeds — deliberately, rather than seeded:
   * a local placeholder row would be money the user never recorded, and its id
   * would 404 the moment it was tapped. `hasLoaded` is what says the real rows
   * are known, and the surfaces that read this render a loading, empty or
   * error state until then (constitution §22).
   */
  transactions: [],

  /** Highest page index successfully loaded; -1 when nothing is loaded yet. */
  loadedPage: -1,
  /** From the last `PageResponse` — `loadedPage + 1 < totalPages` means more. */
  totalPages: 0,
  /** From the last `PageResponse`. The account's true row count, not the loaded one. */
  totalElements: 0,

  /** The page-0 read is in flight. */
  isLoading: false,
  /** A `loadMoreTransactions` read is in flight. */
  isLoadingMore: false,
  /** True once a page-0 read has succeeded — i.e. `transactions` is the server's. */
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

  /**
   * A create or an update is in flight. One slot, so Add Expense's Save button
   * disables against either — the same single-slot reasoning
   * `useCategoriesStore.isCreating` records: it bounds a user holding down Save
   * at one request per confirmed write, and removes any need to reconcile two
   * writes answered out of order.
   */
  isSaving: false,
  /** A delete is in flight (Transaction Detail's confirmed Delete). */
  isDeleting: false,
  ...CACHE_CONTRACT_STATE,
};

/**
 * The row as screens currently see it — the snapshot with queued writes
 * applied (ADR 0027 §8.8). The queued-write paths diff against this, so an
 * edit of a transaction that is itself still waiting to sync works.
 *
 * @param {object} state
 * @param {string} id
 * @returns {object | null}
 */
function findVisibleTransaction(state, id) {
  const ops = selectActiveOps(getOps(), 'transactions', state.fetchStartedAt);
  return overlayTransactions(state.transactions, ops).find((row) => row.id === id) ?? null;
}

/**
 * The minimum a row needs to be rendered, keyed, and acted on: an id, a title,
 * a numeric amount, the three fields `IconBadge` and the list row compose
 * unconditionally, and a `version` to send back on an update.
 *
 * `httpClient` already normalizes unparseable JSON, but an empty `200` body
 * resolves to `null` (ADR 0016 §3.1) and a proxy or captive portal can hand
 * back something else entirely — neither may reach a `.toLocaleString()` in a
 * screen.
 *
 * @param {unknown} entry
 * @returns {boolean}
 */
function isTransactionEntry(entry) {
  return (
    entry != null &&
    typeof entry.id === 'string' &&
    typeof entry.title === 'string' &&
    typeof entry.amount === 'number' &&
    typeof entry.categoryName === 'string' &&
    typeof entry.categoryGlyph === 'string' &&
    typeof entry.txnDate === 'string' &&
    Number.isInteger(entry.version)
  );
}

/**
 * Validates one `PageResponse<TransactionResponse>` (api-overview.md's "Common
 * types"). Returns the page, or `null` when the response is not one at all.
 *
 * Nothing is renamed or reshaped; the only normalization is filling the
 * present-but-null keys the contract guarantees, so no consumer has to defend
 * against their absence (the uniform-key-set convention ADR 0003 §2
 * established and §3.1 restates).
 *
 * @param {unknown} response
 * @returns {{ content: object[], page: number, totalPages: number, totalElements: number } | null}
 */
function toTransactionPage(response) {
  if (!response || !Array.isArray(response.content)) {
    return null;
  }
  if (!response.content.every(isTransactionEntry)) {
    return null;
  }
  return {
    content: response.content.map(normalizeTransaction),
    page: Number.isInteger(response.page) ? response.page : 0,
    totalPages: Number.isInteger(response.totalPages) ? response.totalPages : 1,
    totalElements: Number.isInteger(response.totalElements) ? response.totalElements : response.content.length,
  };
}

/**
 * Fills the nullable keys the contract says are always present, and **drops
 * §4.3's three detail-only fields** so they can never be held in the list.
 *
 * `receiptSignedUrl` is the one that matters: it is a short-lived bearer
 * credential for financial PII and must not be cached or persisted anywhere
 * (docs/decisions/0020-receipt-upload-cloudinary-signed-direct.md §5.2/§7),
 * and a Zustand store is exactly the kind of place a value like that ends up
 * living for a whole session by accident. `paymentMethodDisplay`/
 * `paymentMethodUpiId` go with it for a plainer reason: they exist only on the
 * single-resource response, so a list row that sometimes carried them — the
 * one the user happened to open — would be a shape no consumer could rely on.
 * `refreshTransaction` returns the full response to its caller instead.
 *
 * Nothing else is renamed or reshaped (constitution §15/§30).
 *
 * @param {object} transaction A `TransactionResponse`.
 * @returns {object}
 */
function normalizeTransaction(transaction) {
  // Deleted from a copy rather than destructured away, so the three field
  // names read as a list of what is excluded and no unused binding is created.
  const listFields = { ...transaction };
  delete listFields.receiptSignedUrl;
  delete listFields.paymentMethodDisplay;
  delete listFields.paymentMethodUpiId;

  return {
    ...listFields,
    categoryId: transaction.categoryId ?? null,
    parentCategoryName: transaction.parentCategoryName ?? null,
    groupId: transaction.groupId ?? null,
    cashAmount: transaction.cashAmount ?? null,
    onlineAmount: transaction.onlineAmount ?? null,
    splitExpenseId: transaction.splitExpenseId ?? null,
    notes: transaction.notes ?? null,
    receiptPublicId: transaction.receiptPublicId ?? null,
  };
}

/**
 * Appends a page, dropping any id already held.
 *
 * **The dedupe is not defensive clutter.** Pagination is an offset into a list
 * that changes underneath it: saving a transaction while page 1 is loaded
 * shifts every later row one position, so the next page would otherwise repeat
 * a row already on screen (and a duplicate `key` in a `FlatList` is a visible
 * React warning, not a silent one). Dropping the newcomer rather than the held
 * copy keeps a locally-updated row — one the user just edited — from being
 * replaced by an older server snapshot of itself.
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
 * discarded rather than written into state (see signOutReset.js — the same
 * guard ADR 0016 §6.6 applies to a rotation that outlives its session).
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
 * `409 VERSION_CONFLICT` (§4.4) — the supplied `version` was stale. **The one
 * error in this domain that means "retry"**: the row is re-read and the user
 * can save again. Deliberately a code check and not just a `409`, because the
 * other `409` on that endpoint (`RECEIPT_ALREADY_ATTACHED`) needs the opposite
 * behaviour.
 *
 * @param {unknown} error
 * @returns {boolean}
 */
function isVersionConflict(error) {
  return isApiError(error) && error.code === 'VERSION_CONFLICT';
}

/**
 * `404 TRANSACTION_NOT_FOUND` (§4.3/§4.4/§4.5) — the row is gone, or was
 * soft-deleted, or belongs to someone else; the contract deliberately makes
 * those indistinguishable. Whichever it is, the held copy is a ghost and is
 * dropped.
 *
 * @param {unknown} error
 * @returns {boolean}
 */
function isTransactionGone(error) {
  return isApiError(error) && error.code === 'TRANSACTION_NOT_FOUND';
}

/**
 * The user-facing copy for a failed write, or `null` when the session itself is
 * what failed — in which case the screen shows nothing, because credentials are
 * already wiped and it is being torn down (errorMessages.js's
 * `isSessionTerminalError` note).
 *
 * @param {unknown} error
 * @returns {string | null}
 */
function toWriteError(error) {
  return isSessionTerminalError(error) ? null : getErrorMessage(error);
}

/**
 * Marks the Statistics tab's cached breakdown out of date after a confirmed
 * transaction write — the mirror of `useCategoriesStore`'s
 * `invalidateTransactionsAfterCategoryWrite`, and the fix for the Project
 * Owner's 2026-11-01 "after saving the expense the stats are not updated in the
 * real time it needs a refresh or refetching to update the stats".
 *
 * **It lives in this store, not in the screens that save**, for the same reason
 * the category one does: a breakdown is an aggregate of these rows, so every
 * write invalidates it, and a rule enforced at the three write paths cannot be
 * forgotten by a fourth screen later. Add Expense, Transaction Detail and the
 * split save all go through those paths and none of them knows this happened.
 *
 * **Unlike the category mirror, it fires no request.** That one re-reads page 0
 * of `GET /transactions` because the user is looking at a list built from it;
 * this one only marks, because the Statistics tab is usually not on screen when
 * a transaction is saved and a read nobody is waiting for is a request spent for
 * nothing. `useStatisticsStore.invalidateCategoryStatistics` owns what
 * "invalidate" means there (including that it is a no-op before the tab has ever
 * loaded), so the two stores' cache rules stay in their own files.
 *
 * **Direction of dependency, deliberately:** the writing store imports the
 * cache it invalidates, and `useStatisticsStore` imports no store at all — so
 * there is no cycle here, exactly as `useCategoriesStore` -> this store has
 * none.
 *
 * Not type-filtered, although §14 is expenses-only. An update can turn an
 * expense into income (and back), so the write that matters is not always the
 * one that looks like it does; the worst case of invalidating on an income write
 * is one extra read the next time the tab is opened, against a silently wrong
 * total if the filter were ever reasoned about incorrectly (constitution §29 —
 * correctness before performance).
 */
function invalidateStatisticsAfterTransactionWrite() {
  useStatisticsStore.getState().invalidateCategoryStatistics();
}

export const useTransactionsStore = create((set, get) => ({
  ...INITIAL_STATE,

  /**
   * Reads page 0 of `GET /transactions`. Cache-first: a second call is a no-op
   * once a read has succeeded, so the Dashboard, Add Expense's recent-category
   * list and Transaction Detail share one request per session rather than
   * spending rate-limit budget each time one of them mounts. Pass
   * `{ force: true }` for an explicit retry, for a pull-to-refresh, or after a
   * category rename/delete (see this file's staleness note).
   *
   * A forced reload **discards accumulated pages and starts again at page 0**,
   * which is the only coherent thing to do: page 1 of a list that has since
   * changed is not page 1 of the list now on screen.
   *
   * Triggered by `useTransactions()` at the point of use — never eagerly at app
   * start, which would put a network call in front of the splash gate (the same
   * arrangement as `useUserSettings`/`useCategories`).
   *
   * @param {{ force?: boolean }} [options]
   * @returns {Promise<void>}
   */
  loadTransactions: async ({ force = false } = {}) => {
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
      const response = await transactionsApi.listTransactions({ page: 0 });
      if (hasSessionChanged(epochAtStart)) {
        return;
      }
      const page = toTransactionPage(response);
      if (!page) {
        throw new Error('The transactions response did not match the contract.');
      }
      set({
        transactions: page.content,
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
        // Offline with cached rows (ADR 0027 §8.8): keep them, say nothing —
        // the offline banner already explains why they did not refresh.
        set({ isLoading: false });
        return;
      }
      // `hasLoaded` stays false, so the Dashboard shows the failure with a
      // Retry instead of an empty list that reads as "you have no
      // transactions" — which, for a finance app, is the most misleading thing
      // a failed read could possibly render. A non-ApiError (the throw above)
      // maps to the generic copy; a stack trace never reaches the user
      // (constitution §22). A terminal 401 shows nothing: the session is
      // already gone and this store is about to be reset.
      set({
        isLoading: false,
        loadError: isSessionTerminalError(error) ? null : getErrorMessage(error),
      });
    }
  },

  /**
   * Appends the next page, if there is one. Driven by the Dashboard list
   * reaching its end; a no-op while any read is in flight, when nothing has
   * loaded yet, or when the last page is already held.
   *
   * On failure the held rows stay exactly as they are and the message goes to
   * `loadMoreError` — losing a screenful of transactions because page 2 timed
   * out would be a worse outcome than the missing page.
   *
   * @returns {Promise<void>}
   */
  loadMoreTransactions: async () => {
    const state = get();
    if (state.isLoading || state.isLoadingMore || !state.hasLoaded || state.isFromCache) {
      // A cached snapshot's page counters describe a list that may have
      // changed; the next page is fetched only after page 0 is re-read.
      return;
    }
    const nextPage = state.loadedPage + 1;
    if (nextPage >= state.totalPages) {
      return;
    }

    const epochAtStart = getSessionEpoch();
    set({ isLoadingMore: true, loadMoreError: null });

    try {
      const response = await transactionsApi.listTransactions({ page: nextPage });
      if (hasSessionChanged(epochAtStart)) {
        return;
      }
      const page = toTransactionPage(response);
      if (!page) {
        throw new Error('The transactions response did not match the contract.');
      }
      set((current) => ({
        transactions: appendPage(current.transactions, page.content),
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
   * `POST /transactions` — Add Expense's create path (§4.2).
   *
   * **Returns its outcome rather than storing an error**, like
   * `useCategoriesStore.createCategory` and `useAuthStore.submitX`: a failed
   * save belongs to the form the user is looking at, and a message left in
   * global state would reappear the next time any form opened. `isSaving` is
   * state, because the Save button reads it.
   *
   * The created row is **prepended**, matching every other store's create
   * convention and keeping the row the user just saved where they can see it.
   * A later reload re-orders it to the server's own `txnDate desc` position,
   * which is correct and expected — a transaction back-dated to last week
   * belongs further down the list, not at the top of it.
   *
   * The server re-validates everything the form checked
   * (security-architecture.md §3). Three outcomes are worth naming, all mapped
   * to copy in errorMessages.js: `400 VALIDATION_ERROR` (a cash/online split
   * that does not sum, or a `categoryId` sent with `type: 'income'`),
   * `403 NOT_GROUP_MEMBER` (**every** group-scoped write until Domain 6 —
   * by design, not a bug) and `404 CATEGORY_NOT_FOUND` (the category was
   * deleted since the picker read it).
   *
   * @param {object} values Intended values in API field names — see
   *   utils/transactionRequests.js.
   * @returns {Promise<{ success: boolean, transaction: object | null, error: string | null }>}
   */
  createTransaction: async (values) => {
    if (get().isSaving) {
      return { success: false, transaction: null, error: null };
    }

    if (OFFLINE_WRITES_ENABLED) {
      // ADR 0027 §8.8: validate (the form already did) -> build op -> durable
      // append -> flush request. The overlay shows the row at once.
      const op = buildTransactionCreateOp({ values });
      const result = await enqueueWrite(op);
      return {
        ...result,
        transaction: result.success ? op.preview.row : null,
        id: op.entityId,
        pending: true,
      };
    }

    const epochAtStart = getSessionEpoch();
    set({ isSaving: true });

    try {
      const created = await transactionsApi.createTransaction(
        buildTransactionCreateRequest(values),
      );
      if (hasSessionChanged(epochAtStart)) {
        return { success: false, transaction: null, error: null };
      }
      if (!isTransactionEntry(created)) {
        throw new Error('The create-transaction response did not match the contract.');
      }
      const transaction = normalizeTransaction(created);
      set((current) => ({
        transactions: [transaction, ...current.transactions],
        totalElements: current.totalElements + 1,
        isSaving: false,
      }));
      invalidateStatisticsAfterTransactionWrite();
      return { success: true, transaction, error: null };
    } catch (error) {
      if (hasSessionChanged(epochAtStart)) {
        return { success: false, transaction: null, error: null };
      }
      set({ isSaving: false });
      return { success: false, transaction: null, error: toWriteError(error) };
    }
  },

  /**
   * Prepends a transaction some OTHER write created server-side — today only
   * the split's consumption-share row (`POST /split-expenses` with
   * `addToPersonalExpenses: true`, §9.1 step 3). One `GET /transactions/{id}`;
   * the row is prepended exactly as `createTransaction` would, and the
   * statistics cache is marked stale for the same reason.
   *
   * A failure is non-fatal for the caller: the split itself is saved, and the
   * row appears on the next list reload.
   *
   * @param {string} id
   * @returns {Promise<{ success: boolean }>}
   */
  adoptCreatedTransaction: async (id) => {
    const epochAtStart = getSessionEpoch();
    try {
      const response = await transactionsApi.getTransaction(id);
      if (hasSessionChanged(epochAtStart) || !isTransactionEntry(response)) {
        return { success: false };
      }
      const transaction = normalizeTransaction(response);
      set((current) =>
        current.transactions.some((held) => held.id === id)
          ? {}
          : {
              transactions: [transaction, ...current.transactions],
              totalElements: current.totalElements + 1,
            },
      );
      invalidateStatisticsAfterTransactionWrite();
      return { success: true };
    } catch (error) {
      return { success: false };
    }
  },

  /**
   * `PATCH /transactions/{id}` — Add Expense's edit path (§4.4).
   *
   * Three things here are the actual substance of this round:
   *
   * 1. **The body is a diff**, built against the held row, so a field the user
   *    did not touch is absent rather than `null` — which is what keeps an
   *    untouched note from being wiped (§4.4's absent-vs-null rule, and the
   *    whole reason `utils/transactionRequests.js` exists).
   * 2. **`version` travels with it**, taken from the held row. The response's
   *    incremented `version` is what replaces it, so the next edit asserts the
   *    right one.
   * 3. **`409 VERSION_CONFLICT` is handled, not just reported.** The row is
   *    re-read before the message is returned, so the form the user is looking
   *    at is sitting on the current version and "save again" actually works.
   *    `conflict: true` lets the screen say so specifically. If the re-read
   *    itself fails there is nothing more to do here — the held `version`
   *    stays stale and the next attempt conflicts again, which is the
   *    conservative direction to fail (constitution §29: correctness first; a
   *    guessed version increment would be a silent overwrite).
   *
   * A `404` means the row was deleted while the form was open: the ghost is
   * dropped from the list and `notFound: true` tells the screen to stop
   * pretending it can be saved.
   *
   * An empty diff resolves `{ success: true }` **without a request** — opening
   * Edit and saving unchanged is not a write.
   *
   * @param {string} id
   * @param {object} values Intended values in API field names.
   * @returns {Promise<{ success: boolean, transaction: object | null, error: string | null,
   *   conflict?: boolean, notFound?: boolean }>}
   */
  updateTransaction: async (id, values) => {
    const state = get();
    if (state.isSaving) {
      return { success: false, transaction: null, error: null };
    }

    if (OFFLINE_WRITES_ENABLED) {
      // ADR 0027 §5.3/§8.8: LWW mode — `version` travels but is not checked,
      // so a queued edit cannot conflict on it. Diffed against the row as
      // the user sees it (snapshot + queued writes).
      const visible = findVisibleTransaction(state, id);
      if (!visible) {
        return {
          success: false,
          transaction: null,
          error: getErrorMessageForCode('TRANSACTION_NOT_FOUND'),
          notFound: true,
        };
      }
      const { op, hasChanges } = buildTransactionUpdateOp({ current: visible, values });
      if (!hasChanges) {
        return { success: true, transaction: visible, error: null };
      }
      const result = await enqueueWrite(op);
      return {
        ...result,
        transaction: result.success ? { ...visible, ...op.preview.patch } : null,
        id,
        pending: true,
      };
    }

    const current = state.transactions.find((transaction) => transaction.id === id);
    if (!current) {
      // Nothing held to diff against, and no `version` to assert. The row was
      // dropped (deleted elsewhere, or the store was reset) while the form was
      // open; a blind write would be exactly the overwrite `version` exists to
      // prevent.
      return {
        success: false,
        transaction: null,
        error: getErrorMessageForCode('TRANSACTION_NOT_FOUND'),
        notFound: true,
      };
    }

    const { body, hasChanges } = buildTransactionUpdateRequest(current, values);
    if (!hasChanges) {
      return { success: true, transaction: current, error: null };
    }

    const epochAtStart = getSessionEpoch();
    set({ isSaving: true });

    try {
      const updated = await transactionsApi.updateTransaction(id, body);
      if (hasSessionChanged(epochAtStart)) {
        return { success: false, transaction: null, error: null };
      }
      if (!isTransactionEntry(updated)) {
        throw new Error('The update-transaction response did not match the contract.');
      }
      const transaction = normalizeTransaction(updated);
      set((state2) => ({
        transactions: state2.transactions.map((held) => (held.id === id ? transaction : held)),
        isSaving: false,
      }));
      invalidateStatisticsAfterTransactionWrite();
      return { success: true, transaction, error: null };
    } catch (error) {
      if (hasSessionChanged(epochAtStart)) {
        return { success: false, transaction: null, error: null };
      }
      set({ isSaving: false });

      if (isVersionConflict(error)) {
        await get().refreshTransaction(id);
        return {
          success: false,
          transaction: null,
          error: toWriteError(error),
          conflict: true,
        };
      }
      if (isTransactionGone(error)) {
        get().dropTransaction(id);
        return {
          success: false,
          transaction: null,
          error: toWriteError(error),
          notFound: true,
        };
      }
      return { success: false, transaction: null, error: toWriteError(error) };
    }
  },

  /**
   * `DELETE /transactions/{id}` — Transaction Detail's confirmed Delete (§4.5).
   *
   * A **soft** delete server-side, but from this client's point of view the row
   * is gone: it is excluded from §4.1 and answers `404` on §4.3 from here on.
   * So the held copy is removed either way, including on a `404` — a row the
   * server says does not exist must not keep sitting in the list as a tappable
   * ghost, and reporting "delete failed" for a transaction that is already
   * deleted would be a worse lie than silence. `totalElements` is decremented
   * with it so the page arithmetic stays honest.
   *
   * It deliberately does **not** cascade into `useSplitExpensesStore`'s
   * participant amounts or either balance store — the same boundary ADR 0007
   * drew and ADR 0009 kept.
   *
   * @param {string} id
   * @returns {Promise<{ success: boolean, error: string | null }>}
   */
  deleteTransaction: async (id) => {
    if (get().isDeleting) {
      return { success: false, error: null };
    }

    if (OFFLINE_WRITES_ENABLED) {
      // Deletes are terminal and always apply (ADR 0027 §5.4).
      const visible = findVisibleTransaction(get(), id);
      const op = buildTransactionDeleteOp({ id, title: visible?.title ?? 'a transaction' });
      const result = await enqueueWrite(op);
      return { ...result, id, pending: true };
    }

    const epochAtStart = getSessionEpoch();
    set({ isDeleting: true });

    try {
      await transactionsApi.deleteTransaction(id);
      if (hasSessionChanged(epochAtStart)) {
        return { success: false, error: null };
      }
      get().dropTransaction(id);
      set({ isDeleting: false });
      // Marked here as well as inside `dropTransaction`, and that overlap is
      // intentional: a row deleted from the Statistics drill-down may never have
      // been in this store's own paginated list (that screen reads
      // `useCategoryTransactionsStore`), in which case `dropTransaction` finds
      // nothing to remove and correctly stays quiet — but the delete still
      // happened and the breakdown it came from is still wrong. Marking twice
      // for one delete is identical in effect to marking once: the invalidation
      // is a monotonic counter, not a queue of refreshes.
      invalidateStatisticsAfterTransactionWrite();
      return { success: true, error: null };
    } catch (error) {
      if (hasSessionChanged(epochAtStart)) {
        return { success: false, error: null };
      }
      set({ isDeleting: false });
      if (isTransactionGone(error)) {
        get().dropTransaction(id);
        invalidateStatisticsAfterTransactionWrite();
        return { success: true, error: null };
      }
      return { success: false, error: toWriteError(error) };
    }
  },

  /**
   * Re-reads one row through `GET /transactions/{id}` (§4.3) and replaces the
   * held copy.
   *
   * Two callers, two reasons: the `409 VERSION_CONFLICT` recovery above needs
   * the current `version`, and Transaction Detail needs the single-resource
   * response at all — the premium payment-method enrichment and
   * `receiptSignedUrl` exist **only** on this endpoint and are deliberately
   * absent from §4.1's list rows.
   *
   * **The enrichment is returned to the caller and NOT stored.**
   * `receiptSignedUrl` is a short-lived bearer credential for financial PII and
   * must not be cached or persisted (ADR 0020 §5.2/§7), so only the base
   * `TransactionResponse` fields go into the list; the screen keeps the rest in
   * component state for the render that needs it.
   *
   * A `404` drops the row rather than reporting a failure — see
   * `deleteTransaction`.
   *
   * @param {string} id
   * @returns {Promise<{ success: boolean, transaction: object | null,
   *   error: string | null, notFound?: boolean }>}
   */
  refreshTransaction: async (id) => {
    const epochAtStart = getSessionEpoch();

    try {
      const response = await transactionsApi.getTransaction(id);
      if (hasSessionChanged(epochAtStart)) {
        return { success: false, transaction: null, error: null };
      }
      if (!isTransactionEntry(response)) {
        throw new Error('The transaction response did not match the contract.');
      }
      const transaction = normalizeTransaction(response);
      set((current) => ({
        transactions: current.transactions.some((held) => held.id === id)
          ? current.transactions.map((held) => (held.id === id ? transaction : held))
          : current.transactions,
      }));
      // The detail-only fields ride back on the returned object, never into
      // the list above.
      return { success: true, transaction: response, error: null };
    } catch (error) {
      if (hasSessionChanged(epochAtStart)) {
        return { success: false, transaction: null, error: null };
      }
      if (isTransactionGone(error)) {
        get().dropTransaction(id);
        return { success: false, transaction: null, error: toWriteError(error), notFound: true };
      }
      return { success: false, transaction: null, error: toWriteError(error) };
    }
  },

  /**
   * Removes one row locally. Not a delete — the delete is the API call above;
   * this is what "the server says this id is gone" does to held state, and it
   * is shared by every path that learns it (delete, a `404` on update, a `404`
   * on re-read). Keeping it in one place is what stops a ghost row from
   * surviving in one of them.
   *
   * **It also marks the statistics cache stale**, because all four of those
   * paths end here and a row the server considers gone is a row §14 has already
   * stopped counting — including the two that are not deletes at all (a `404`
   * on update or on re-read means another client removed it). It marks only when
   * a row genuinely went away: an id that was not held changes no aggregate and
   * must not cost the Statistics tab a re-read. `deleteTransaction` marks on its
   * own confirmed success too, for the case where the deleted row was never in
   * this store's pages — see the note there.
   *
   * @param {string} id
   */
  dropTransaction: (id) => {
    const state = get();
    const held = state.transactions.filter((transaction) => transaction.id !== id);
    if (held.length === state.transactions.length) {
      return;
    }
    set({
      transactions: held,
      totalElements: Math.max(0, state.totalElements - 1),
    });
    invalidateStatisticsAfterTransactionWrite();
  },

  /**
   * Drops this account's transactions — see signOutReset.js. There is
   * deliberately no separate "clear errors" action: each operation clears its
   * own message when it starts, and sign-out clears everything.
   */
  resetTransactions: () => set({ ...INITIAL_STATE }),

  /**
   * ADR 0027 §8.8 — shows the cached rows at once. Page counters are rebuilt
   * from the cached row count; `isFromCache` makes the next load re-read
   * page 0 (which replaces the accumulated list, §8.7) and holds back
   * `loadMoreTransactions` until it has.
   *
   * @param {{ transactions: object[], totalElements: number }} data
   * @param {string | null} fetchStartedAt
   */
  hydrateFromCache: (data, fetchStartedAt) => {
    if (!Array.isArray(data?.transactions) || !data.transactions.every(isTransactionEntry)) {
      return;
    }
    const transactions = data.transactions.map(normalizeTransaction);
    const pagesHeld = Math.max(1, Math.ceil(transactions.length / TRANSACTION_PAGE_SIZE));
    const totalElements = Number.isInteger(data.totalElements)
      ? data.totalElements
      : transactions.length;
    set({
      transactions,
      loadedPage: pagesHeld - 1,
      totalPages: Math.max(pagesHeld, Math.ceil(totalElements / TRANSACTION_PAGE_SIZE)),
      totalElements,
      hasLoaded: true,
      isFromCache: true,
      fetchStartedAt,
      loadError: null,
      loadMoreError: null,
    });
  },
}));

registerSignOutReset(() => {
  useTransactionsStore.getState().resetTransactions();
});

bindStorePersistence(useTransactionsStore, {
  storeKey: 'transactions',
  watch: (state) => [state.transactions, state.totalElements],
  // Capped at 1,000 rows, newest first (§8.3). `normalizeTransaction` has
  // already dropped `receiptSignedUrl`/`paymentMethodDisplay`/
  // `paymentMethodUpiId`, so nothing here can re-add them (§8.3).
  select: (state) => ({
    transactions: state.transactions.slice(0, CACHE_CAPS.transactions),
    totalElements: state.totalElements,
  }),
  pull: () => useTransactionsStore.getState().loadTransactions({ force: true }),
  pullOrder: 5,
});
