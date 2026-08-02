import { create } from 'zustand';
import * as groupsApi from '../api/groupsApi';
import * as splitsApi from '../api/splitsApi';
import { isApiError } from '../api/apiError';
import { getErrorMessage, isSessionTerminalError } from '../api/errorMessages';
import { buildSettlementRequest } from '../utils/splitRequests';
import { bindStorePersistence } from '../offline/persistence';
import { buildGroupCreateOp } from '../offline/operations/groups';
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
 * The groups the signed-in account belongs to — server-backed by
 * `GET /api/v1/groups`, `GET /api/v1/groups/{id}` and `POST /api/v1/groups`
 * (docs/api/api-overview.md §7.1–§7.3), plus the group half of
 * `POST /api/v1/splits/settle` (§10.1, as corrected by
 * docs/decisions/0023-shared-ledger-contract-corrections.md §4).
 *
 * **Replaces the three seeded mock groups** this store held since
 * docs/decisions/0005-split-add-expense-flow.md §2.1, and with them the two
 * local mutators that are now impossible by design — see below.
 *
 * Layering: stores may import `src/api/*`; screens may not (ADR 0016 §1). The
 * orchestration lives here, never in a screen (constitution §8).
 *
 * ---
 * **SHAPE: `GroupResponse`, HELD VERBATIM.**
 *
 *   { id, name, createdByUserId, lastActivity, members[], yourBalance,
 *     createdAt, updatedAt }
 *
 * Three differences from the old mock shape, all of which screens read:
 *
 * - **`members[]` replaces `memberContactIds[]`**, and it is richer in the way
 *   that matters: each entry is `{ userId, invitedContactId, name, role }` with
 *   exactly one id set, which is the identity vocabulary `POST /split-expenses`
 *   and `POST /splits/settle` require for this group (`backend/README.md` §16.6
 *   assumption 6). A member is no longer resolved through the contact list at
 *   all — `name` is resolved server-side.
 * - **The creator is already in `members[]`** (§7.1), so a member count is
 *   `members.length`, never `members.length + 1` as the mock shape needed.
 * - **`lastActivity` is always `null`.** Nothing on the backend writes it, by
 *   decision (`backend/README.md` §16.6 assumption 20), so no consumer may
 *   depend on it — `utils/splitBalances.js#describeGroupSubtitle` treats it as
 *   optional.
 *
 * ---
 * **`yourBalance` IS SHARED STATE. THE LOCAL MUTATORS ARE GONE.**
 *
 * `applySplitExpense(groupId, delta, label)` and `settleBalance(groupId)` used
 * to move a private number on this device. Both are deleted, and not as
 * cleanup: a group balance is one row per member of a shared ledger, and
 * **another member's split or settlement moves it with no action here** (ADR
 * 0023 §1, its Frontend follow-up). A client that applied its own deltas would
 * drift from the server the first time anybody else acted, and would do it
 * invisibly.
 *
 * So every write **re-reads** instead of adjusting: `settleGroupBalance` calls
 * `GET /groups/{id}` after a successful settlement, and the split-expense save
 * does the same through `reloadGroup`. `remainingBalance` on §10.1's response is
 * deliberately not used for this — keeping a second source for one shared
 * number is how the two come to disagree (constitution §17).
 *
 * ---
 * **RESET ON SIGN-OUT.** Registered with signOutReset.js like every other
 * per-account cache, with the same in-flight epoch guard.
 */

/**
 * The one condition in this domain that has a real server behaviour and **no
 * error code of its own**: a group settlement whose direction contradicts the
 * ledger (both parties owing, both owed, or either at zero) is
 * `400 VALIDATION_ERROR` with no `fieldErrors` (ADR 0023 §4.2,
 * `backend/README.md` §16.5 note 7).
 *
 * `VALIDATION_ERROR`'s shared copy — "Please check the highlighted fields" —
 * would be actively wrong here: there is no highlighted field, and the problem
 * is not what the user typed. So this one flow substitutes copy that says what
 * actually happened, and only when the `400` carries no field errors (a genuine
 * field problem still gets the shared message and the field markers).
 *
 * Flagged in this round's report: a dedicated code would let this live in
 * `errorMessages.js` with every other mapping instead of beside its one call
 * site.
 */
const SETTLEMENT_DIRECTION_MESSAGE =
  "That doesn't match the balances — a settlement needs one of you to owe the other. Reload the group and check who owes what.";

const INITIAL_STATE = {
  /** @type {object[]} `GroupResponse[]` in the server's order. */
  groups: [],
  /** The list read is in flight. */
  isLoading: false,
  /** True once a list read has succeeded. */
  hasLoaded: false,
  /** User-facing copy for a failed list read (constitution §22), or null. */
  loadError: null,
  /** A `POST /groups` is in flight. */
  isSaving: false,
  /** A `POST /splits/settle` for a group is in flight. */
  isSettling: false,
  ...CACHE_CONTRACT_STATE,
};

/**
 * The minimum one group needs to be keyed, listed and used as a split target.
 *
 * `members` and `yourBalance` are both required, deliberately: a group row
 * renders a member count and a balance unconditionally, and a missing
 * `yourBalance` would otherwise reach a `.toLocaleString()` — or worse, read as
 * "settled up" when nothing is known.
 *
 * @param {unknown} entry
 * @returns {boolean}
 */
function isGroupEntry(entry) {
  return (
    Boolean(entry) &&
    typeof entry.id === 'string' &&
    entry.id.length > 0 &&
    typeof entry.name === 'string' &&
    Array.isArray(entry.members) &&
    Number.isFinite(entry.yourBalance)
  );
}

/**
 * Fills the present-but-null keys consumers read, and pins each member to the
 * two-column identity shape §7.1 guarantees. Nothing is renamed, re-sorted or
 * recomputed — in particular `yourBalance` is taken exactly as the server
 * states it, already oriented to the caller.
 *
 * @param {object} group
 * @returns {object}
 */
function normalizeGroup(group) {
  return {
    ...group,
    lastActivity: group.lastActivity ?? null,
    members: group.members.map((member) => ({
      ...member,
      userId: member.userId ?? null,
      invitedContactId: member.invitedContactId ?? null,
      name: member.name ?? '',
      // ADR 0028 §8.1 (supersedes ADR 0009 §5): the member's own net, positive
      // = owed. `null` from a server that predates it — the Balances tab then
      // shows names only and never guesses a figure.
      balance: Number.isFinite(member.balance) ? member.balance : null,
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

/**
 * `404 GROUP_NOT_FOUND` — the group is gone, the caller is no longer a member,
 * or (on a settlement) the counterpart is not a member. All three are the same
 * code on purpose and none of them is a permissions failure (§2's convention).
 *
 * @param {unknown} error
 * @returns {boolean}
 */
function isGroupGone(error) {
  return isApiError(error) && error.code === 'GROUP_NOT_FOUND';
}

/**
 * The user-facing copy for a failed settlement, with the one substitution this
 * flow needs (see SETTLEMENT_DIRECTION_MESSAGE), or `null` when the session
 * itself is what failed — in which case the screen shows nothing, because
 * credentials are already wiped and it is being torn down.
 *
 * @param {unknown} error
 * @returns {string | null}
 */
function toSettlementError(error) {
  if (isSessionTerminalError(error)) {
    return null;
  }
  if (isApiError(error) && error.code === 'VALIDATION_ERROR' && error.fieldErrors.length === 0) {
    return SETTLEMENT_DIRECTION_MESSAGE;
  }
  return getErrorMessage(error);
}

export const useGroupsStore = create((set, get) => ({
  ...INITIAL_STATE,

  /**
   * Reads `GET /groups` (§7.1). Cache-first: a second call is a no-op once a
   * read has succeeded, so the Split tab, Split Add Expense's group picker and
   * Add Expense's group field share one request per session. `{ force: true }`
   * is the explicit retry and the post-write refresh.
   *
   * Triggered by `useGroups()` at the point of use — never eagerly at app
   * start.
   *
   * @param {{ force?: boolean }} [options]
   * @returns {Promise<void>}
   */
  loadGroups: async ({ force = false } = {}) => {
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
      const response = await groupsApi.listGroups();
      if (hasSessionChanged(epochAtStart)) {
        return;
      }
      if (!Array.isArray(response) || !response.every(isGroupEntry)) {
        throw new Error('The groups response did not match the contract.');
      }
      set({
        groups: response.map(normalizeGroup),
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
      // Retry instead of an empty list that reads as "you have no groups" —
      // which, in front of a user who is owed money by one, is a false
      // statement about their finances (constitution §22).
      set({
        isLoading: false,
        loadError: isSessionTerminalError(error) ? null : getErrorMessage(error),
      });
    }
  },

  /**
   * Re-reads one group (`GET /groups/{id}`, §7.3) and replaces it in the held
   * list. **This is how a group balance stays true after a write**, rather than
   * by applying a local delta — see this file's note.
   *
   * A `404` removes the group from the list: it is gone, or the caller is no
   * longer a member, and either way the held copy is a ghost. Any other failure
   * leaves the held copy alone and says nothing: the write it follows already
   * succeeded, so the balance on screen is merely stale, and replacing a good
   * list with an error because a *refresh* failed would be the worse outcome.
   *
   * @param {string} groupId
   * @returns {Promise<void>}
   */
  reloadGroup: async (groupId) => {
    if (!groupId) {
      return;
    }
    const epochAtStart = getSessionEpoch();

    try {
      const response = await groupsApi.getGroup(groupId);
      if (hasSessionChanged(epochAtStart)) {
        return;
      }
      if (!isGroupEntry(response)) {
        throw new Error('The group response did not match the contract.');
      }
      const group = normalizeGroup(response);
      set((current) => ({
        groups: current.groups.map((held) => (held.id === group.id ? group : held)),
      }));
    } catch (error) {
      if (hasSessionChanged(epochAtStart)) {
        return;
      }
      if (isGroupGone(error)) {
        set((current) => ({
          groups: current.groups.filter((held) => held.id !== groupId),
        }));
      }
    }
  },

  /**
   * `POST /groups` (§7.2) — New Group's Create button.
   *
   * Returns its outcome rather than storing an error, the same convention as
   * every other write in this app. The created group is prepended so it is at
   * the top of the Split tab's list, and it is returned so the caller can hand
   * it straight to Split Add Expense's `selectedGroup` round trip without a
   * second lookup.
   *
   * `memberContactIds` are the caller's own **contact** ids; the creator is
   * added server-side and must not be listed. Duplicates collapse rather than
   * erroring (§7.2 defines no `409`).
   *
   * @param {{ name: string, memberContactIds?: string[] }} values
   * @returns {Promise<{ success: boolean, group: object | null, error: string | null }>}
   */
  createGroup: async ({ name, memberContactIds = [], members = [] }) => {
    if (get().isSaving) {
      return { success: false, group: null, error: null };
    }

    if (OFFLINE_WRITES_ENABLED) {
      // ADR 0027 §8.8: queued, not awaited on the network. The returned group
      // is the overlay's estimated row, so the caller's round trip into Split
      // Add Expense works the same offline.
      const op = buildGroupCreateOp({ name, memberContactIds, members });
      const result = await enqueueWrite(op);
      const group = result.success
        ? { id: op.entityId, name, members, yourBalance: 0, lastActivity: null }
        : null;
      return { ...result, group, id: op.entityId, pending: true };
    }

    const epochAtStart = getSessionEpoch();
    set({ isSaving: true });

    try {
      const created = await groupsApi.createGroup({ name, memberContactIds });
      if (hasSessionChanged(epochAtStart)) {
        return { success: false, group: null, error: null };
      }
      if (!isGroupEntry(created)) {
        throw new Error('The create-group response did not match the contract.');
      }
      const group = normalizeGroup(created);
      set((current) => ({
        groups: [group, ...current.groups],
        isSaving: false,
      }));
      return { success: true, group, error: null };
    } catch (error) {
      if (hasSessionChanged(epochAtStart)) {
        return { success: false, group: null, error: null };
      }
      set({ isSaving: false });
      return {
        success: false,
        group: null,
        error: isSessionTerminalError(error) ? null : getErrorMessage(error),
      };
    }
  },

  /**
   * `POST /splits/settle` with `target: 'group'` (§10.1 + ADR 0023 §4) — the
   * group half of Settle Up.
   *
   * Three things here are the substance of this round:
   *
   * 1. **A counterpart is required**, and `utils/splitRequests.js` is where
   *    that rule lives. §10.1's request block does not list the field; the
   *    backend requires it, and without it every group settlement fails
   *    (`backend/README.md` §16.6 flag-back 1).
   * 2. **The balance is re-read on success**, never adjusted locally. A group
   *    settlement moves *both* members' rows server-side, in one transaction,
   *    in whichever direction the ledger says — so the only reliable source for
   *    what the caller's balance now is, is the server.
   * 3. **It is also re-read on `400 AMOUNT_EXCEEDS_BALANCE`.** That rejection
   *    means the amount exceeded `min(|debtor|, creditor)` — which can happen
   *    because the counterpart is owed less than the caller owes, *or* because
   *    somebody else moved the balance since this screen read it. Re-reading is
   *    what makes the mapped copy's "we reloaded the balance; check the amount"
   *    a true statement and the retry worth making.
   *
   * The direction is never sent: the server derives it from the two balances
   * and rejects a contradiction with a field-less `400 VALIDATION_ERROR`, which
   * `toSettlementError` turns into copy that names the real problem.
   *
   * @param {{ groupId: string, counterpartUserId?: string | null,
   *   counterpartContactId?: string | null, amount: number,
   *   method: 'marked_paid' | 'upi' }} values
   * @returns {Promise<{ success: boolean, error: string | null }>}
   */
  settleGroupBalance: async ({
    groupId,
    counterpartUserId = null,
    counterpartContactId = null,
    amount,
    method,
    displayedBalance = null,
  }) => {
    if (get().isSettling) {
      return { success: false, error: null };
    }

    if (OFFLINE_WRITES_ENABLED) {
      const group = get().groups.find((held) => held.id === groupId);
      const op = buildSettlementCreateOp({
        target: 'group',
        groupId,
        counterpartUserId,
        counterpartContactId,
        amount,
        method,
        displayedBalance: displayedBalance ?? group?.yourBalance ?? 0,
        label: group?.name ?? 'a group',
        // The feed overlay's payer/payee name (ADR 0028 §7.7).
        counterpartName:
          group?.members.find(
            (member) =>
              (counterpartUserId && member.userId === counterpartUserId) ||
              (counterpartContactId && member.invitedContactId === counterpartContactId),
          )?.name ?? '',
      });
      const result = await enqueueWrite(op);
      return { ...result, id: op.entityId, pending: true };
    }

    const epochAtStart = getSessionEpoch();
    set({ isSettling: true });

    try {
      await splitsApi.settleUp(
        buildSettlementRequest({
          target: 'group',
          groupId,
          counterpartUserId,
          counterpartContactId,
          amount,
          method,
        }),
      );
      if (hasSessionChanged(epochAtStart)) {
        return { success: false, error: null };
      }
      // The settlement landed. What the caller's balance now is, is the
      // server's to say — including any movement caused by the other party.
      await get().reloadGroup(groupId);
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
      if (isApiError(error) && error.code === 'AMOUNT_EXCEEDS_BALANCE') {
        // Deliberately not awaited before the message is returned: the screen
        // should say what happened immediately, and the refreshed balance
        // arrives behind it through the store's own subscription.
        get().reloadGroup(groupId);
      }
      return { success: false, error: toSettlementError(error) };
    }
  },

  /**
   * ADR 0027 §8.8 — shows the cached list at once; `isFromCache` makes the
   * next `loadGroups` re-read it.
   *
   * @param {{ groups: object[] }} data
   * @param {string | null} fetchStartedAt
   */
  hydrateFromCache: (data, fetchStartedAt) => {
    if (!Array.isArray(data?.groups) || !data.groups.every(isGroupEntry)) {
      return;
    }
    set({
      groups: data.groups.map(normalizeGroup),
      hasLoaded: true,
      isFromCache: true,
      fetchStartedAt,
      loadError: null,
    });
  },

  /** Drops this account's groups — see signOutReset.js. */
  resetGroups: () => set({ ...INITIAL_STATE }),
}));

registerSignOutReset(() => {
  useGroupsStore.getState().resetGroups();
});

bindStorePersistence(useGroupsStore, {
  storeKey: 'groups',
  watch: (state) => [state.groups],
  select: (state) => ({ groups: state.groups }),
  pull: () => useGroupsStore.getState().loadGroups({ force: true }),
  pullOrder: 7,
});
