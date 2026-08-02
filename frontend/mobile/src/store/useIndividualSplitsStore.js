import { create } from 'zustand';
import * as splitsApi from '../api/splitsApi';
import { isApiError } from '../api/apiError';
import { getErrorMessage, isSessionTerminalError } from '../api/errorMessages';
import { buildSettlementRequest } from '../utils/splitRequests';
import { bindStorePersistence } from '../offline/persistence';
import { buildSettlementCreateOp } from '../offline/operations/settlements';
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
 * The signed-in account's **pairwise balances** — server-backed by
 * `GET /api/v1/splits/individuals` (docs/api/api-overview.md §8.1, as corrected
 * by docs/decisions/0023-shared-ledger-contract-corrections.md §1), plus the
 * individual half of `POST /api/v1/splits/settle` (§10.1).
 *
 * **Replaces the four seeded mock entries** this store held since
 * docs/decisions/0004-split-individual-tab.md §4 / ADR 0005 §2.2, and with them
 * `applySplitExpense`'s find-or-create rule and `settleBalance`'s local zeroing
 * — both now impossible by design (see below). The file keeps its historical
 * name; the data it holds is `individual_balances`, one row per pair.
 *
 * Layering: stores may import `src/api/*`; screens may not (ADR 0016 §1). The
 * orchestration lives here, never in a screen (constitution §8).
 *
 * ---
 * **SHAPE: `IndividualBalanceResponse`, HELD VERBATIM.**
 *
 *   { id, counterpartUserId, counterpartContactId, counterpartName, balance,
 *     updatedAt }
 *
 * Mapped against the old mock shape so the differences are explicit:
 * `id` is now the **balance row's** id (what §9.3 filters by and §10.1 settles),
 * `counterpartName` replaces `personName`, `balance` replaces `yourBalance`,
 * and **`lastActivity` has no field behind it at all** — §8.1 states
 * `updatedAt` and nothing else, which is what
 * `utils/splitBalances.js#describeBalanceUpdatedAt` renders instead of
 * inventing an activity line.
 *
 * ---
 * **`balance` IS ALREADY ORIENTED TO THE CALLER. IT IS NEVER NEGATED HERE.**
 *
 * One row per registered pair, signed relative to the canonical (lesser-uuid)
 * `user_id`; the server reads **both** sides and flips the sign exactly once,
 * in `IndividualBalanceService#orientToCaller`, when the caller is the
 * canonical counterpart (ADR 0023 §1.4, its Frontend follow-up,
 * `backend/README.md` §16.1). So `balance > 0` means *you are owed* and
 * `balance < 0` means *you owe*, for every row, in every direction. A second
 * flip anywhere on this side would show every debt backwards — and would look
 * entirely plausible doing it, which is why this is stated in the store, the
 * api module and the util that formats it.
 *
 * ---
 * **A PAIRWISE BALANCE IS SHARED, SO THERE ARE NO LOCAL MUTATORS.**
 *
 * The old `applySplitExpense(contactId, delta, label)` and
 * `settleBalance(individualId)` moved a private number on this device. Both are
 * deleted: after ADR 0023 §1 a pair is **one row that both parties read and
 * settle**, so it can change because the other party acted, with no action
 * here. Reconciling that by applying local deltas is not merely imprecise, it
 * is wrong in a way no user could see.
 *
 * Every write therefore **re-reads the list** rather than adjusting a held
 * value, and `remainingBalance` on §10.1's response is deliberately not used
 * for it: one shared number must have one source (constitution §17). The list
 * read is one unpaginated request, so a refresh is cheap.
 *
 * Two consequences worth knowing at the call sites:
 *
 * - **A new pair row appears by refresh, not by find-or-create.** Saving the
 *   first split with a contact creates the row server-side (§9.1 resolves or
 *   creates it, by the one rule ADR 0023 §1.3 insists exists in exactly one
 *   place). The client discovers it by re-reading, which is also how it learns
 *   the row's id.
 * - **A pair that has a private contact row keeps using it after the contact
 *   links to a real account.** That merge is undesigned (ADR 0023 Open Question
 *   1) and no write path improvises it, so two linked users may briefly hold
 *   separate rows. Nothing here can or should paper over that.
 *
 * ---
 * **RESET ON SIGN-OUT.** Registered with signOutReset.js like every other
 * per-account cache, with the same in-flight epoch guard.
 */

const INITIAL_STATE = {
  /** @type {object[]} `IndividualBalanceResponse[]` in the server's order. */
  balances: [],
  /** The list read is in flight. */
  isLoading: false,
  /** True once a list read has succeeded. */
  hasLoaded: false,
  /** User-facing copy for a failed list read (constitution §22), or null. */
  loadError: null,
  /** A `POST /splits/settle` for a pair is in flight. */
  isSettling: false,
  ...CACHE_CONTRACT_STATE,
};

/**
 * The minimum one pairwise balance needs to be keyed, listed, settled and used
 * as a split-expense filter.
 *
 * `balance` is required and `counterpartName` is required: a row renders both
 * unconditionally, and a missing balance would read as "settled up" when in
 * fact nothing is known — the one thing a money screen may not say.
 *
 * Neither counterpart id is required, because exactly one of them is null by
 * contract and which one is not this predicate's business.
 *
 * @param {unknown} entry
 * @returns {boolean}
 */
function isBalanceEntry(entry) {
  return (
    Boolean(entry) &&
    typeof entry.id === 'string' &&
    entry.id.length > 0 &&
    typeof entry.counterpartName === 'string' &&
    Number.isFinite(entry.balance)
  );
}

/**
 * Fills the present-but-null keys consumers read. Nothing is renamed,
 * re-sorted, recomputed or **re-signed**.
 *
 * @param {object} balance
 * @returns {object}
 */
function normalizeBalance(balance) {
  return {
    ...balance,
    counterpartUserId: balance.counterpartUserId ?? null,
    counterpartContactId: balance.counterpartContactId ?? null,
    updatedAt: balance.updatedAt ?? null,
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

export const useIndividualSplitsStore = create((set, get) => ({
  ...INITIAL_STATE,

  /**
   * Reads `GET /splits/individuals` (§8.1). Cache-first: a second call is a
   * no-op once a read has succeeded. `{ force: true }` is the explicit retry
   * and the post-write refresh — which this domain uses more than most, because
   * the rows are shared.
   *
   * Triggered by `useIndividualBalances()` at the point of use.
   *
   * @param {{ force?: boolean }} [options]
   * @returns {Promise<void>}
   */
  loadIndividualBalances: async ({ force = false } = {}) => {
    const state = get();
    if (state.isLoading) {
      return;
    }
    if (!shouldFetch(state, force)) {
      return;
    }

    const epochAtStart = getSessionEpoch();
    const fetchStartedAt = nowIso();
    set({ isLoading: true, loadError: null });

    try {
      const response = await splitsApi.listIndividualBalances();
      if (hasSessionChanged(epochAtStart)) {
        return;
      }
      if (!Array.isArray(response) || !response.every(isBalanceEntry)) {
        throw new Error('The individual balances response did not match the contract.');
      }
      set({
        balances: response.map(normalizeBalance),
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
      // `hasLoaded` stays false, so the Split tab shows the failure with a
      // Retry rather than an empty list. "No individual splits yet" in front of
      // a user who is owed ₹450 is a lie about their money, and a read that
      // genuinely came back empty is a different state entirely.
      set({
        isLoading: false,
        loadError: isSessionTerminalError(error) ? null : getErrorMessage(error),
      });
    }
  },

  /**
   * `POST /splits/settle` with `target: 'individual'` (§10.1) — the pairwise
   * half of Settle Up.
   *
   * **No counterpart is sent, and that is the contract**, not an omission: the
   * `individual_balances` row *is* the pair, so both parties are already in the
   * row this settlement references and either of them may record it (ADR 0023
   * §4's "why nothing for the individual case"). `utils/splitRequests.js` is
   * where that asymmetry with the group case lives.
   *
   * **Partial settlement is supported**: the balance is reduced to its
   * residual, never zeroed, and the bound is `|balance|` — rejected rather than
   * clamped, and never allowed to flip into a reverse debt (§10.1 step 3,
   * ADR 0017 §4). `400 AMOUNT_EXCEEDS_BALANCE` is also the answer when there is
   * nothing outstanding at all.
   *
   * The list is re-read on success **and** on `AMOUNT_EXCEEDS_BALANCE`: the row
   * is shared, so a rejection can mean the other party settled first, and the
   * refreshed figure is what makes the mapped copy's "we reloaded the balance"
   * true. A `404` drops the row, which is the only honest thing to do with an
   * id the server no longer recognises.
   *
   * @param {{ individualBalanceId: string, amount: number,
   *   method: 'marked_paid' | 'upi' }} values
   * @returns {Promise<{ success: boolean, error: string | null }>}
   */
  settleIndividualBalance: async ({
    individualBalanceId,
    amount,
    method,
    counterpartContactId = null,
    displayedBalance = null,
  }) => {
    if (get().isSettling) {
      return { success: false, error: null };
    }

    if (OFFLINE_WRITES_ENABLED) {
      // ADR 0027 §7.2: a pair created offline has no server id yet, so it is
      // settled by contact. `individualBalanceId` is used whenever it exists.
      const row = get().balances.find((entry) => entry.id === individualBalanceId);
      const op = buildSettlementCreateOp({
        target: 'individual',
        individualBalanceId: row ? individualBalanceId : null,
        individualCounterpartContactId: row ? null : counterpartContactId,
        amount,
        method,
        displayedBalance: displayedBalance ?? row?.balance ?? 0,
        label: row?.counterpartName ?? 'a contact',
        // The feed overlay's payer/payee (ADR 0028 §7.7). Not sent: an
        // individual settlement's body names no counterpart.
        counterpartUserId: row?.counterpartUserId ?? null,
        counterpartName: row?.counterpartName ?? '',
      });
      const result = await enqueueWrite(op);
      return { ...result, id: op.entityId, pending: true };
    }

    const epochAtStart = getSessionEpoch();
    set({ isSettling: true });

    try {
      await splitsApi.settleUp(
        buildSettlementRequest({
          target: 'individual',
          individualBalanceId,
          amount,
          method,
        }),
      );
      if (hasSessionChanged(epochAtStart)) {
        return { success: false, error: null };
      }
      await get().loadIndividualBalances({ force: true });
      if (hasSessionChanged(epochAtStart)) {
        return { success: false, error: null };
      }
      set({ isSettling: false });
      return { success: true, error: null };
    } catch (error) {
      if (hasSessionChanged(epochAtStart)) {
        return { success: false, error: null };
      }
      set({ isSettling: false });

      if (isApiError(error) && error.code === 'INDIVIDUAL_BALANCE_NOT_FOUND') {
        set((current) => ({
          balances: current.balances.filter((entry) => entry.id !== individualBalanceId),
        }));
      } else if (isApiError(error) && error.code === 'AMOUNT_EXCEEDS_BALANCE') {
        // Not awaited: the screen says what happened immediately, and the
        // refreshed balance arrives behind it through the subscription.
        get().loadIndividualBalances({ force: true });
      }

      return {
        success: false,
        error: isSessionTerminalError(error) ? null : getErrorMessage(error),
      };
    }
  },

  /**
   * ADR 0027 §8.8 — shows the cached balances at once; the next load re-reads.
   *
   * @param {{ balances: object[] }} data
   * @param {string | null} fetchStartedAt
   */
  hydrateFromCache: (data, fetchStartedAt) => {
    if (!Array.isArray(data?.balances) || !data.balances.every(isBalanceEntry)) {
      return;
    }
    set({
      balances: data.balances.map(normalizeBalance),
      hasLoaded: true,
      isFromCache: true,
      fetchStartedAt,
      loadError: null,
    });
  },

  /** Drops this account's balances — see signOutReset.js. */
  resetIndividualBalances: () => set({ ...INITIAL_STATE }),
}));

registerSignOutReset(() => {
  useIndividualSplitsStore.getState().resetIndividualBalances();
});

bindStorePersistence(useIndividualSplitsStore, {
  storeKey: 'individualBalances',
  watch: (state) => [state.balances],
  select: (state) => ({ balances: state.balances }),
  pull: () => useIndividualSplitsStore.getState().loadIndividualBalances({ force: true }),
  pullOrder: 8,
});
