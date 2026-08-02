import { create } from 'zustand';
import { getErrorMessageForCode } from '../api/errorMessages';
import { getOps, subscribeOutbox, isUnsynced } from '../offline/outbox';
import {
  getNotices,
  getLastSuccessfulSyncAt,
  subscribeNotices,
  dismissNotice as dismissStoredNotice,
} from '../offline/notices';
import { getIsOnline, subscribeOnline, refreshIsOnline } from '../offline/connectivity';
import {
  startSyncEngine,
  stopSyncEngine,
  syncNow as engineSyncNow,
  retryOp as engineRetryOp,
  discardOp as engineDiscardOp,
  subscribeSyncEvents,
  getEngineStatus,
} from '../offline/syncEngine';
import { hydrateAccount, deactivatePersistence } from '../offline/persistence';
import { wipeAccount } from '../offline/cacheStore';
import { peekDeviceId } from '../offline/deviceId';
import { collectDependents } from '../offline/dependencies';
import { LARGE_OUTBOX_THRESHOLD } from '../offline/config';
import { getSessionEpoch, registerSignOutReset } from './signOutReset';

/**
 * UI-facing sync state — docs/decisions/0027-offline-first-local-cache-and-replay-sync.md §8.9.
 *
 * Mirrors the outbox, notices, connectivity and engine status into one Zustand
 * store so the banner, the Sync Status screen, the view hooks and Profile's
 * sign-out check can subscribe to it. It owns no queue logic: every action
 * delegates to `src/offline`.
 *
 * It also owns the account-session lifecycle of the offline layer:
 * - `startAccountSession(userId)` — hydrate caches + outbox (the post-auth
 *   gate awaits it, §8.4), then `startEngine()` once the gate's budget read
 *   is done;
 * - the sign-out handler — stop the engine, stop persisting, and wipe the
 *   account's namespace: **caches only on a forced logout** (the outbox and
 *   notices survive for the same user's next sign-in), **everything on a
 *   deliberate logout** (§8.10).
 */

const INITIAL_STATE = {
  /** Outbox ops in queue order (read-only copies). */
  ops: [],
  /** Sync notices, newest first. */
  notices: [],
  lastSuccessfulSyncAt: null,
  isOnline: getIsOnline(),
  isFlushing: false,
  /** `'update_required'` when the outbox holds an op from a newer app version. */
  pausedReason: null,
  /** The account whose offline session is running, or null. */
  sessionUserId: null,
  /** This install's `X-Device-Id`, once one exists — the change log compares against it. */
  deviceId: null,
};

/**
 * Ops not yet acknowledged or superseded — what a sign-out would delete.
 *
 * @param {object[]} ops
 * @returns {number}
 */
export function countUnsyncedOps(ops) {
  return ops.filter(isUnsynced).length;
}

/**
 * @param {object[]} ops
 * @returns {number}
 */
export function countWaitingOps(ops) {
  return ops.filter((op) => op.status === 'pending' || op.status === 'inflight').length;
}

/**
 * @param {object[]} ops
 * @returns {number}
 */
export function countFailedOps(ops) {
  return ops.filter((op) => op.status === 'failed' || op.status === 'blocked').length;
}

/**
 * The reason line Sync Status shows under a failed or blocked op (§8.9): the
 * mapped error copy, never the server's raw message.
 *
 * @param {object} op
 * @returns {string | null}
 */
export function describeOpFailure(op) {
  if (op.status === 'blocked') {
    return "Waiting on an earlier change that couldn't sync.";
  }
  if (op.status === 'failed' || op.status === 'superseded') {
    return getErrorMessageForCode(op.lastError?.code);
  }
  return null;
}

/**
 * Banner state (§8.9). Pure, so the copy rules are testable without React.
 *
 * @param {{ isOnline: boolean, isFlushing: boolean, ops: object[] }} state
 * @returns {{ kind: 'offline' | 'syncing' | 'failed' | 'hidden', waitingCount: number,
 *   failedCount: number, isLarge: boolean }}
 */
export function deriveBannerState({ isOnline, isFlushing, ops }) {
  const waitingCount = countWaitingOps(ops);
  const failedCount = countFailedOps(ops);
  const isLarge = waitingCount > LARGE_OUTBOX_THRESHOLD;
  if (!isOnline) {
    return { kind: 'offline', waitingCount, failedCount, isLarge };
  }
  if (isFlushing && waitingCount > 0) {
    return { kind: 'syncing', waitingCount, failedCount, isLarge };
  }
  if (failedCount > 0) {
    return { kind: 'failed', waitingCount, failedCount, isLarge };
  }
  return { kind: 'hidden', waitingCount, failedCount, isLarge };
}

/** @type {Promise<void> | null} */
let sessionStartPromise = null;

export const useSyncStore = create((set, get) => ({
  ...INITIAL_STATE,

  /**
   * Local and fast: hydrates the account's caches and outbox, then starts the
   * engine. Idempotent per account — a second call for the same user resolves
   * the first call's promise.
   *
   * @param {string} userId
   * @returns {Promise<void>}
   */
  startAccountSession: (userId) => {
    if (!userId) {
      return Promise.resolve();
    }
    if (get().sessionUserId === userId && sessionStartPromise) {
      return sessionStartPromise;
    }
    set({ sessionUserId: userId });
    sessionStartPromise = (async () => {
      await refreshIsOnline();
      await hydrateAccount(userId);
      peekDeviceId()
        .then((deviceId) => useSyncStore.setState({ deviceId }))
        .catch(() => {});
    })();
    return sessionStartPromise;
  },

  /**
   * Starts the engine (flush + start-up pull) for the hydrated account. The
   * post-auth gate calls it after its own budget read, so the start-up pull
   * never races the gate's 5 s read of the active period (§8.4).
   */
  startEngine: () => {
    const userId = get().sessionUserId;
    if (userId) {
      startSyncEngine({ userId, getSessionEpoch });
    }
  },

  /** "Sync now" (§8.9). No-op offline. */
  syncNow: () => engineSyncNow('sync-now'),

  /** @param {string} opId */
  retryOp: (opId) => engineRetryOp(opId),

  /**
   * @param {string} opId
   * @returns {Promise<string[]>} Discarded ids (the op and its dependents).
   */
  discardOp: (opId) => engineDiscardOp(opId),

  /**
   * The ops a Discard would remove with `opId` — for the confirmation copy.
   *
   * @param {string} opId
   * @returns {object[]}
   */
  getDependentsOf: (opId) => {
    const ops = get().ops;
    const ids = new Set(collectDependents(opId, ops));
    return ops.filter((op) => ids.has(op.opId));
  },

  /** @param {string} noticeId */
  dismissNotice: (noticeId) => dismissStoredNotice(noticeId),

  /**
   * Profile's Log Out check (§8.9).
   *
   * @returns {number}
   */
  getUnsyncedCount: () => countUnsyncedOps(get().ops),
}));

// --- mirrors ---------------------------------------------------------------

subscribeOutbox(() => {
  useSyncStore.setState({ ops: getOps().slice() });
});

subscribeNotices(() => {
  useSyncStore.setState({
    notices: getNotices().slice(),
    lastSuccessfulSyncAt: getLastSuccessfulSyncAt(),
  });
});

subscribeOnline((isOnline) => {
  useSyncStore.setState({ isOnline });
});

subscribeSyncEvents(() => {
  const { isFlushing, pausedReason } = getEngineStatus();
  useSyncStore.setState({ isFlushing, pausedReason });
});

// --- sign-out (§8.10) ------------------------------------------------------

registerSignOutReset((state, previousState) => {
  stopSyncEngine();
  const persistedUserId = deactivatePersistence();
  const userId = previousState?.user?.id ?? persistedUserId;
  // `null` = deliberate logout -> wipe everything. A forced logout keeps the
  // outbox and notices so the same user's queued changes still sync.
  const keepOutbox = state?.sessionEndedReason != null;
  sessionStartPromise = null;
  useSyncStore.setState({
    ops: [],
    notices: [],
    lastSuccessfulSyncAt: null,
    isFlushing: false,
    pausedReason: null,
    sessionUserId: null,
  });
  wipeAccount(userId, { keepOutbox }).catch((error) => {
    if (__DEV__) {
      console.log(`[offline] wipe failed: ${error && error.message}`);
    }
  });
});
