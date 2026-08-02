import { create } from 'zustand';
import * as splitsApi from '../api/splitsApi';
import { getErrorMessage, isSessionTerminalError } from '../api/errorMessages';
import { buildSplitExpenseCreateRequest } from '../utils/splitRequests';
import {
  resolveSplitExpenseCounterparts,
  resolveSplitExpensePayers,
  splitExpenseMovesPair,
} from '../utils/splitParticipants';
import { bindStorePersistence } from '../offline/persistence';
import {
  buildSplitCreateOp,
  buildSplitDeleteOp,
  buildSplitUpdateOp,
} from '../offline/operations/splits';
import { isApiError } from '../api/apiError';
import { CACHE_CAPS } from '../offline/config';
import { getSessionEpoch, registerSignOutReset } from './signOutReset';
import {
  CACHE_CONTRACT_STATE,
  OFFLINE_WRITES_ENABLED,
  enqueueWrite,
  keepsSnapshotOnFailure,
  nowIso,
  shouldFetch,
} from './offlineStoreSupport';

/**
 * The itemized split-expense history for **one target at a time** —
 * server-backed by `GET /api/v1/split-expenses?groupId=` or
 * `?individualBalanceId=` (docs/api/api-overview.md §9.3) and
 * `POST /api/v1/split-expenses` (§9.1).
 *
 * **Replaces the flat local array** this store held since
 * docs/decisions/0005-split-add-expense-flow.md §2.3. The reason it is no
 * longer flat is the contract: §9.3 requires **exactly one** of `groupId` /
 * `individualBalanceId` — there is no "all my split expenses" endpoint — so the
 * client holds the one target it is displaying, keyed by which target that is.
 * Same single-slot-with-a-key shape as `useCategoryTransactionsStore`, and for
 * the same reason: a different key clears the slot before it fetches, because
 * one target's history rendered under another's heading would be a false
 * statement about who spent what.
 *
 * Layering: stores may import `src/api/*`; screens may not (ADR 0016 §1). The
 * orchestration lives here, never in a screen (constitution §8).
 *
 * ---
 * **SHAPE: `SplitExpenseResponse`, HELD VERBATIM.**
 *
 *   { id, title, categoryId, categoryName, parentCategoryName,
 *     categoryIconName, categoryGlyph, categoryTone, splitDate, amount,
 *     splitMode, groupId, individualBalanceId, counterparts[], splitMethod,
 *     paidByUserId, paidByContactId, paidByName, payers[],
 *     addedToPersonalExpenses, personalTransactionId, participants[],
 *     createdAt, updatedAt }
 *
 * `individualBalanceId` is deprecated (ADR 0026 §5.2): it names the primary
 * counterpart's pair only. Read `counterparts[]` for every pair a split moved.
 *
 * `paidBy*` are deprecated (ADR 0025 §5.2): they name the primary payer only.
 * Read `payers[]` for who paid and how much.
 *
 * The API's own field names, nothing renamed (constitution §15/§30). Mapped
 * against the old local shape, for the screens that read it: `date` ->
 * `splitDate`, `category`/`iconName`/`glyph`/`tone` -> the five
 * `category*` snapshot fields, `individualId` -> `individualBalanceId`,
 * `paidById` -> `paidByUserId`/`paidByContactId` (+ a server-resolved
 * `paidByName`), and `participants[].participantId` ->
 * `participantUserId`/`participantContactId` (+ a frozen `name`).
 *
 * **The category snapshot is frozen and `categoryId` is never null** — a split
 * saved with no category carries the creator's protected `Misc` row instead
 * (ADR 0023 §3), so a row always composes a name and a glyph. Note that a
 * category rename does **not** yet refresh these snapshots for split expenses
 * (`backend/README.md` §16.8), unlike transactions; that is a backend
 * follow-up, not something to patch around here.
 *
 * **`participants[].name` is frozen at save time**, deliberately unlike
 * `GroupResponse.members[].name`, which is resolved at read time. A row is a
 * historical record of who owed what (§9.3, extending ADR 0008 §1.3), so it is
 * never re-resolved against the current contact list.
 *
 * ---
 * **ORDER IS THE SERVER'S.** `split_date desc, id` (`backend/README.md` §16.6
 * assumption 17). Nothing here re-sorts; the screen groups by date for its
 * section headers and preserves the order inside each bucket.
 *
 * ---
 * **RESET ON SIGN-OUT.** Registered with signOutReset.js, with the same
 * in-flight epoch guard every other per-account store uses.
 */

const INITIAL_STATE = {
  /** @type {string | null} The `groupId` the held rows belong to, if any. */
  groupId: null,
  /** @type {string | null} The `individualBalanceId` the held rows belong to, if any. */
  individualBalanceId: null,
  /** @type {object[]} `SplitExpenseResponse[]` for that one target. */
  splitExpenses: [],
  /** The list read is in flight. */
  isLoading: false,
  /** True once a list read has succeeded for the current target. */
  hasLoaded: false,
  /** User-facing copy for a failed list read (constitution §22), or null. */
  loadError: null,
  /** A `POST /split-expenses` is in flight. */
  isSaving: false,
  /**
   * Offline cache of recently viewed targets (ADR 0027 §8.3: 30 targets, LRU,
   * 200 rows each): `{ [targetKey]: { rows, fetchStartedAt, lastUsedAt } }`.
   * Opening a cached target shows its rows at once and re-reads behind them.
   */
  cachedTargets: {},
  ...CACHE_CONTRACT_STATE,
};

/**
 * @param {string | null} groupId
 * @param {string | null} individualBalanceId
 * @returns {string}
 */
function toTargetKey(groupId, individualBalanceId) {
  return groupId ? `group:${groupId}` : `pair:${individualBalanceId}`;
}

/**
 * Records one target's rows in the LRU cache, trimming to the caps.
 *
 * @param {object} cachedTargets
 * @param {string} targetKey
 * @param {object[]} rows
 * @param {string} fetchStartedAt
 * @returns {object}
 */
function rememberTarget(cachedTargets, targetKey, rows, fetchStartedAt) {
  const next = {
    ...cachedTargets,
    [targetKey]: {
      rows: rows.slice(0, CACHE_CAPS.splitExpenseRowsPerTarget),
      fetchStartedAt,
      lastUsedAt: nowIso(),
    },
  };
  const keys = Object.keys(next);
  if (keys.length <= CACHE_CAPS.splitExpenseTargets) {
    return next;
  }
  keys
    .sort((left, right) => next[left].lastUsedAt.localeCompare(next[right].lastUsedAt))
    .slice(0, keys.length - CACHE_CAPS.splitExpenseTargets)
    .forEach((key) => {
      delete next[key];
    });
  return next;
}

/**
 * The minimum one split expense needs to be keyed and rendered: an id, a title,
 * a numeric amount, the snapshot name/glyph the row composes unconditionally,
 * a date to bucket by, and the participant list its per-row arithmetic reads.
 *
 * `httpClient` already normalizes unparseable JSON, but an empty `200` body
 * resolves to `null` (ADR 0016 §3.1) and a proxy can hand back something else;
 * neither may reach a `.reduce()` over participants in a screen.
 *
 * @param {unknown} entry
 * @returns {boolean}
 */
export function isSplitExpenseEntry(entry) {
  return (
    Boolean(entry) &&
    typeof entry.id === 'string' &&
    entry.id.length > 0 &&
    typeof entry.title === 'string' &&
    Number.isFinite(entry.amount) &&
    typeof entry.categoryName === 'string' &&
    typeof entry.categoryGlyph === 'string' &&
    typeof entry.splitDate === 'string' &&
    Array.isArray(entry.participants)
  );
}

/**
 * Fills the present-but-null keys consumers read, and pins each participant to
 * the two-column identity shape §9.3 guarantees. Nothing is renamed, re-sorted
 * or recomputed — in particular no total is derived here: the screen sums the
 * full, unpaginated list for one target, which is a real total.
 *
 * @param {object} splitExpense
 * @returns {object}
 */
export function normalizeSplitExpense(splitExpense) {
  return {
    ...splitExpense,
    // ADR 0028 §6.4 (additive): who added it and, inside a feed, who deleted
    // it. `null` from a server that predates ADR 0028 (§11.8).
    createdByUserId: splitExpense.createdByUserId ?? null,
    createdByName: splitExpense.createdByName ?? null,
    deletedAt: splitExpense.deletedAt ?? null,
    deletedByUserId: splitExpense.deletedByUserId ?? null,
    deletedByName: splitExpense.deletedByName ?? null,
    categoryId: splitExpense.categoryId ?? null,
    parentCategoryName: splitExpense.parentCategoryName ?? null,
    groupId: splitExpense.groupId ?? null,
    individualBalanceId: splitExpense.individualBalanceId ?? null,
    paidByUserId: splitExpense.paidByUserId ?? null,
    paidByContactId: splitExpense.paidByContactId ?? null,
    paidByName: splitExpense.paidByName ?? '',
    // §9.3's `payers[]` (ADR 0025 §5.2/§8.7) — who paid how much. The deprecated
    // `paidBy*` above describe the primary payer only and are kept for now;
    // readers use `payers`. A server that predates ADR 0025 sends no `payers`,
    // so one entry is synthesised from `paidBy*` + `amount` (a single payer
    // paid the whole bill), keeping every reader on one shape.
    payers: resolveSplitExpensePayers(splitExpense).map((payer) => ({
      ...payer,
      payerUserId: payer.payerUserId ?? null,
      payerContactId: payer.payerContactId ?? null,
      name: payer.name ?? '',
    })),
    // §9.3's `counterparts[]` (ADR 0026 §5.2/§8.5) — every pair row an
    // individual split moved, `[]` for a group split. The deprecated
    // `individualBalanceId` above names the primary counterpart's pair only.
    // A server that predates ADR 0026 sends none, so one entry is synthesised
    // from `individualBalanceId` with `netAmount: null` (see
    // `resolveSplitExpenseCounterparts`).
    counterparts: resolveSplitExpenseCounterparts(splitExpense).map((counterpart) => ({
      ...counterpart,
      counterpartUserId: counterpart.counterpartUserId ?? null,
      counterpartContactId: counterpart.counterpartContactId ?? null,
      name: counterpart.name ?? '',
      netAmount: Number.isFinite(counterpart.netAmount) ? counterpart.netAmount : null,
    })),
    personalTransactionId: splitExpense.personalTransactionId ?? null,
    participants: splitExpense.participants.map((participant) => ({
      ...participant,
      participantUserId: participant.participantUserId ?? null,
      participantContactId: participant.participantContactId ?? null,
      name: participant.name ?? '',
    })),
  };
}

/**
 * True when the session changed while a request was in flight (see
 * signOutReset.js). Returning without clearing the in-flight flag is
 * deliberate and safe: the sign-out reset has already restored INITIAL_STATE.
 *
 * @param {number} epochAtStart
 * @returns {boolean}
 */
function hasSessionChanged(epochAtStart) {
  return getSessionEpoch() !== epochAtStart;
}

export const useSplitExpensesStore = create((set, get) => ({
  ...INITIAL_STATE,

  /**
   * Reads `GET /split-expenses` for one target (§9.3).
   *
   * **Exactly one of `groupId`/`individualBalanceId` is required** — neither or
   * both is a `400 VALIDATION_ERROR` server-side, so a call with the wrong
   * shape is refused here rather than spent on a round trip.
   *
   * Cache-first **for the same target**: re-entering the same group's detail
   * screen within a session is free. A different target clears the held rows
   * first, so the previous group's history can never render under this one's
   * name. `{ force: true }` is the explicit retry and the post-write refresh.
   *
   * @param {{ groupId?: string | null, individualBalanceId?: string | null,
   *   force?: boolean }} options
   * @returns {Promise<void>}
   */
  loadSplitExpenses: async ({ groupId = null, individualBalanceId = null, force = false }) => {
    const hasExactlyOneTarget = Boolean(groupId) !== Boolean(individualBalanceId);
    if (!hasExactlyOneTarget) {
      return;
    }

    const state = get();
    if (state.isLoading) {
      return;
    }
    const isSameTarget =
      state.groupId === groupId && state.individualBalanceId === individualBalanceId;
    if (isSameTarget && !shouldFetch(state, force)) {
      return;
    }

    const epochAtStart = getSessionEpoch();
    const fetchStartedAt = nowIso();
    const targetKey = toTargetKey(groupId, individualBalanceId);
    const cached = state.cachedTargets[targetKey];
    if (isSameTarget) {
      set({ isLoading: true, loadError: null });
    } else if (cached && Array.isArray(cached.rows) && cached.rows.every(isSplitExpenseEntry)) {
      // A different target with a cached history (ADR 0027 §8.3): show it at
      // once, labelled as from cache, and re-read behind it.
      set({
        ...INITIAL_STATE,
        cachedTargets: state.cachedTargets,
        groupId,
        individualBalanceId,
        splitExpenses: cached.rows.map(normalizeSplitExpense),
        hasLoaded: true,
        isFromCache: true,
        fetchStartedAt: cached.fetchStartedAt ?? null,
        isLoading: true,
      });
    } else {
      set({
        ...INITIAL_STATE,
        cachedTargets: state.cachedTargets,
        groupId,
        individualBalanceId,
        isLoading: true,
      });
    }

    try {
      const response = await splitsApi.listSplitExpenses({ groupId, individualBalanceId });
      if (hasSessionChanged(epochAtStart)) {
        return;
      }
      if (!Array.isArray(response) || !response.every(isSplitExpenseEntry)) {
        throw new Error('The split expenses response did not match the contract.');
      }
      const splitExpenses = response.map(normalizeSplitExpense);
      set((current) => ({
        splitExpenses,
        groupId,
        individualBalanceId,
        isLoading: false,
        hasLoaded: true,
        loadError: null,
        fetchStartedAt,
        isFromCache: false,
        cachedTargets: rememberTarget(current.cachedTargets, targetKey, splitExpenses, fetchStartedAt),
      }));
    } catch (error) {
      if (hasSessionChanged(epochAtStart)) {
        return;
      }
      if (keepsSnapshotOnFailure(get(), error)) {
        set({ isLoading: false });
        return;
      }
      // `hasLoaded` stays false, so Split Detail shows the failure with a Retry
      // instead of "no expenses yet in this group" — which would be a false
      // statement about a shared history, under a balance saying money is owed.
      set({
        isLoading: false,
        loadError: isSessionTerminalError(error) ? null : getErrorMessage(error),
      });
    }
  },

  /**
   * `POST /split-expenses` (§9.1) — Split Add Expense's save.
   *
   * Returns its outcome rather than storing an error, the same convention as
   * every other write in this app. The request body is built by
   * `utils/splitRequests.js`, which is also where the `addToPersonalExpenses`
   * decision and the participant identity resolution are explained; a body it
   * cannot build throws, is caught here, and becomes the generic copy rather
   * than an opaque `400` from the server.
   *
   * **The caller must refresh the affected balance afterwards** — the group's
   * or the pair's — and `hooks/useSplitExpenseSave.js` is where that sequence
   * lives. This action does not reach into the balance stores itself: a split
   * moves *every* participant's balance, not just one, so "what my balance is
   * now" is a question only the server can answer and only a re-read can
   * deliver (ADR 0023 §1).
   *
   * If the held target is the one this split was saved against, its list is
   * re-read so a mounted Split Detail is immediately correct. A held list for a
   * *different* target is untouched, because a split on one target cannot
   * change another's history.
   *
   * @param {object} values See `buildSplitExpenseCreateRequest`.
   * @returns {Promise<{ success: boolean, splitExpense: object | null,
   *   error: string | null }>}
   */
  createSplitExpense: async (values) => {
    if (get().isSaving) {
      return { success: false, splitExpense: null, error: null };
    }

    if (OFFLINE_WRITES_ENABLED) {
      // ADR 0027 §3.2/§8.8: the split (and, with addToPersonalExpenses, the
      // caller's consumption-share transaction) gets its final id now; the
      // overlay shows both and the balance estimates at once. `offline` is
      // supplied by useSplitExpenseSave (the caller's paid/share figures).
      let op;
      try {
        op = buildSplitCreateOp({ values, ...(values.offline || {}) });
      } catch (error) {
        return { success: false, splitExpense: null, error: getErrorMessage(error) };
      }
      const result = await enqueueWrite(op);
      return {
        ...result,
        splitExpense: result.success
          ? { id: op.entityId, personalTransactionId: op.body.personalTransactionId ?? null }
          : null,
        id: op.entityId,
        pending: true,
      };
    }

    const epochAtStart = getSessionEpoch();
    set({ isSaving: true });

    try {
      const created = await splitsApi.createSplitExpense(
        buildSplitExpenseCreateRequest(values),
      );
      if (hasSessionChanged(epochAtStart)) {
        return { success: false, splitExpense: null, error: null };
      }
      if (!isSplitExpenseEntry(created)) {
        throw new Error('The create-split-expense response did not match the contract.');
      }
      const splitExpense = normalizeSplitExpense(created);
      set({ isSaving: false });

      const state = get();
      // `counterparts[]`, never the deprecated `individualBalanceId` (ADR 0026
      // §8.5): a multi-contact split moves several pairs, and the held one may
      // be a non-primary pair whose open Split Detail must still refresh.
      const affectsHeldTarget =
        (splitExpense.groupId && splitExpense.groupId === state.groupId) ||
        splitExpenseMovesPair(splitExpense, state.individualBalanceId);
      if (affectsHeldTarget) {
        // Re-read rather than prepend: the server decides this list's order
        // (`split_date desc`), and a back-dated split does not belong at the
        // top of it.
        get().loadSplitExpenses({
          groupId: state.groupId,
          individualBalanceId: state.individualBalanceId,
          force: true,
        });
      }

      return { success: true, splitExpense, error: null };
    } catch (error) {
      if (hasSessionChanged(epochAtStart)) {
        return { success: false, splitExpense: null, error: null };
      }
      set({ isSaving: false });
      return {
        success: false,
        splitExpense: null,
        error: isSessionTerminalError(error) ? null : getErrorMessage(error),
      };
    }
  },

  /**
   * `PUT /split-expenses/{id}` (api-overview.md §9.4,
   * docs/decisions/0028-split-expense-edit-delete-feeds-and-balance-copy.md
   * §6/§11.5). With `OFFLINE_WRITES_ENABLED` the edit is queued as
   * `split.update` and the overlays preview it; otherwise it is sent directly
   * and `hooks/useSplitExpenseSave.js` re-reads what it moved.
   *
   * @param {string} id
   * @param {{ splitExpense: object, body: object, after: object,
   *   currentUserId: string }} values `body` from `buildSplitExpenseUpdateRequest`,
   *   `after` from `projectSplitExpenseEdit`.
   * @returns {Promise<{ success: boolean, splitExpense: object | null,
   *   error: string | null, pending?: boolean }>}
   */
  updateSplitExpense: async (id, values) => {
    if (get().isSaving) {
      return { success: false, splitExpense: null, error: null };
    }
    if (OFFLINE_WRITES_ENABLED) {
      let op;
      try {
        op = buildSplitUpdateOp(values);
      } catch (error) {
        return { success: false, splitExpense: null, error: getErrorMessage(error) };
      }
      const result = await enqueueWrite(op);
      return { ...result, splitExpense: result.success ? values.after : null, pending: true };
    }

    const epochAtStart = getSessionEpoch();
    set({ isSaving: true });
    try {
      const updated = await splitsApi.updateSplitExpense(id, values.body);
      if (hasSessionChanged(epochAtStart)) {
        return { success: false, splitExpense: null, error: null };
      }
      if (!isSplitExpenseEntry(updated)) {
        throw new Error('The update-split-expense response did not match the contract.');
      }
      set({ isSaving: false });
      return { success: true, splitExpense: normalizeSplitExpense(updated), error: null };
    } catch (error) {
      if (hasSessionChanged(epochAtStart)) {
        return { success: false, splitExpense: null, error: null };
      }
      set({ isSaving: false });
      return {
        success: false,
        splitExpense: null,
        error: isSessionTerminalError(error) ? null : getErrorMessage(error),
      };
    }
  },

  /**
   * `DELETE /split-expenses/{id}` (§9.5, ADR 0028 §2.3/§11.6). Queued as
   * `split.delete` when offline writes are on. A `404` means the split is
   * already gone, which is the outcome the user asked for, so it is success.
   *
   * @param {string} id
   * @param {{ splitExpense: object, currentUserId: string }} values
   * @returns {Promise<{ success: boolean, error: string | null, pending?: boolean }>}
   */
  deleteSplitExpense: async (id, values) => {
    if (get().isSaving) {
      return { success: false, error: null };
    }
    if (OFFLINE_WRITES_ENABLED) {
      const op = buildSplitDeleteOp(values);
      const result = await enqueueWrite(op);
      return { ...result, pending: true };
    }

    const epochAtStart = getSessionEpoch();
    set({ isSaving: true });
    try {
      await splitsApi.deleteSplitExpense(id);
      if (hasSessionChanged(epochAtStart)) {
        return { success: false, error: null };
      }
      set({ isSaving: false });
      return { success: true, error: null };
    } catch (error) {
      if (hasSessionChanged(epochAtStart)) {
        return { success: false, error: null };
      }
      set({ isSaving: false });
      if (isApiError(error) && error.code === 'SPLIT_EXPENSE_NOT_FOUND') {
        return { success: true, error: null };
      }
      return { success: false, error: isSessionTerminalError(error) ? null : getErrorMessage(error) };
    }
  },

  /** Drops the held target and its rows — see signOutReset.js. */
  resetSplitExpenses: () => set({ ...INITIAL_STATE }),

  /**
   * ADR 0027 §8.3/§8.8. Only the per-target cache is restored: no target is
   * "current" after a restart, so `hasLoaded` stays false until Split Detail
   * opens one — at which point `loadSplitExpenses` serves it from here.
   *
   * @param {{ targets: object }} data
   */
  hydrateFromCache: (data) => {
    if (!data || typeof data.targets !== 'object' || data.targets === null) {
      return;
    }
    set({ cachedTargets: data.targets });
  },
}));

registerSignOutReset(() => {
  useSplitExpensesStore.getState().resetSplitExpenses();
});

bindStorePersistence(useSplitExpensesStore, {
  storeKey: 'splitExpenses',
  watch: (state) => [state.cachedTargets],
  select: (state) => ({ targets: state.cachedTargets }),
  pull: () => {
    const { groupId, individualBalanceId } = useSplitExpensesStore.getState();
    return useSplitExpensesStore
      .getState()
      .loadSplitExpenses({ groupId, individualBalanceId, force: true });
  },
  pullOrder: 9,
});
