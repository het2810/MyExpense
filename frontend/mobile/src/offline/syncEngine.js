import { AppState } from 'react-native';
import { authorizedRequest } from '../api/apiClient';
import {
  getOps,
  getOp,
  updateOp,
  removeOps,
  hasFutureVersionOp,
  OP_STATUS,
} from './outbox';
import { resolveDependencyState, collectDependents, indexOpsById } from './dependencies';
import { classify, computeBackoffMs, toLastError } from './errorClassification';
import { addNotice, recordSuccessfulSync } from './notices';
import { getIsOnline, subscribeOnline } from './connectivity';
import { getDeviceId } from './deviceId';
import { pullAll, getSnapshotFetchStartedAt } from './persistence';

/**
 * The flush loop — docs/decisions/0027-offline-first-local-cache-and-replay-sync.md §8.6/§8.7.
 *
 * - **Single flight, strictly sequential.** One flush at a time (a
 *   module-level promise); one request at a time, in queue order — which is
 *   what makes FIFO order equal causal order.
 * - **Dependencies:** an op waits for its dependencies; if one failed or is
 *   blocked, it becomes `blocked` (§8.6).
 * - **A permanent failure never blocks the queue**, only its dependents.
 * - **Transient failure** stops the flush and schedules a backoff retry.
 * - **Session safety:** the session epoch is captured at flush start and the
 *   flush stops after any `await` where it moved (§8.6). It is injected by the
 *   store layer, because `src/offline` never imports `src/store`.
 * - **Pull** after a flush that sent at least one op, on reconnect and on start.
 *
 * Triggers: `requestFlush(reason)` from an enqueue, NetInfo online, AppState
 * active, the end of hydration, "Sync now", and the backoff timer.
 *
 * Logging (dev only): op ids, types and codes. Never a body (§10.4).
 */

let engineUserId = null;
let getSessionEpoch = () => 0;
/** @type {Promise<void> | null} */
let flushPromise = null;
let isFlushing = false;
let consecutiveTransientFailures = 0;
/** @type {ReturnType<typeof setTimeout> | null} */
let backoffTimer = null;
/** @type {null | 'update_required'} */
let pausedReason = null;
let unsubscribeOnline = null;
let appStateSubscription = null;
/** @type {Set<(event: { type: string, op?: object }) => void>} */
const listeners = new Set();

/**
 * @param {{ type: string, op?: object }} event
 */
function emit(event) {
  listeners.forEach((listener) => listener(event));
}

/**
 * @param {string} message
 */
function logDev(message) {
  if (__DEV__) {
    console.log(`[sync] ${message}`);
  }
}

function clearBackoff() {
  if (backoffTimer) {
    clearTimeout(backoffTimer);
    backoffTimer = null;
  }
}

/**
 * @param {number} floorMs
 */
function scheduleBackoff(floorMs) {
  clearBackoff();
  const delay = computeBackoffMs(consecutiveTransientFailures, { floorMs });
  backoffTimer = setTimeout(() => {
    backoffTimer = null;
    requestFlush('backoff');
  }, delay);
}

/**
 * The four write headers (§4.1).
 *
 * @param {object} op
 * @returns {Promise<Record<string, string>>}
 */
async function buildWriteHeaders(op) {
  const isFirstLiveAttempt = op.attempts <= 1 && op.enqueuedOnline;
  return {
    'Idempotency-Key': op.opId,
    'X-Client-Updated-At': op.clientUpdatedAt,
    'X-Client-Origin': isFirstLiveAttempt ? 'live' : 'replay',
    'X-Device-Id': await getDeviceId(),
  };
}

/**
 * The first op that may be sent now, marking newly-blocked ops on the way.
 *
 * @returns {Promise<object | null>}
 */
async function nextSendableOp() {
  const ops = getOps();
  const byId = indexOpsById(ops);
  for (const op of ops) {
    if (op.status !== OP_STATUS.pending) {
      continue;
    }
    const dependencyState = resolveDependencyState(op, byId);
    if (dependencyState === 'blocked') {
      await updateOp(op.opId, { status: OP_STATUS.blocked });
      byId[op.opId] = { ...op, status: OP_STATUS.blocked };
      continue;
    }
    if (dependencyState === 'ready') {
      return op;
    }
  }
  return null;
}

/**
 * Marks every pending dependent of a permanently failed op as blocked.
 *
 * @param {string} opId
 */
async function blockDependents(opId) {
  const ops = getOps();
  for (const dependentId of collectDependents(opId, ops)) {
    const dependent = getOp(dependentId);
    if (dependent && dependent.status === OP_STATUS.pending) {
      await updateOp(dependentId, { status: OP_STATUS.blocked });
    }
  }
}

/**
 * Deletes acked ops that no longer contribute to any view (§8.8): an acked op
 * is active for store S only while `ackedAt > S.fetchStartedAt`.
 */
export async function pruneAckedOps() {
  const removable = getOps()
    .filter((op) => op.status === OP_STATUS.acked || op.status === OP_STATUS.superseded)
    .filter((op) => {
      if (op.status === OP_STATUS.superseded) {
        return true;
      }
      return (op.affects || []).every((storeKey) => {
        const fetchStartedAt = getSnapshotFetchStartedAt(storeKey);
        if (fetchStartedAt === undefined || fetchStartedAt === null) {
          return true;
        }
        return op.ackedAt <= fetchStartedAt;
      });
    })
    .map((op) => op.opId);
  if (removable.length > 0) {
    await removeOps(removable);
  }
}

/**
 * @returns {Promise<void>}
 */
async function runFlush() {
  const epochAtStart = getSessionEpoch();
  const userAtStart = engineUserId;
  const isCurrent = () => getSessionEpoch() === epochAtStart && engineUserId === userAtStart;

  if (hasFutureVersionOp()) {
    pausedReason = 'update_required';
    emit({ type: 'paused' });
    return;
  }
  pausedReason = null;

  let sentAny = false;
  let stoppedTransient = false;

  while (getIsOnline()) {
    const op = await nextSendableOp();
    if (!isCurrent()) {
      return;
    }
    if (!op) {
      break;
    }

    await updateOp(op.opId, { status: OP_STATUS.inflight, attempts: (op.attempts || 0) + 1 });
    if (!isCurrent()) {
      return;
    }
    const sending = getOp(op.opId);

    let error = null;
    try {
      const headers = await buildWriteHeaders(sending);
      await authorizedRequest(sending.path, {
        method: sending.method,
        body: sending.body,
        headers,
      });
    } catch (caught) {
      error = caught;
    }
    if (!isCurrent()) {
      return;
    }

    const { outcome, backoffFloorMs } = classify(sending, error);
    logDev(`${sending.type} ${sending.opId} -> ${outcome}${error?.code ? ` ${error.code}` : ''}`);

    if (outcome === 'acked') {
      consecutiveTransientFailures = 0;
      sentAny = true;
      await updateOp(op.opId, {
        status: OP_STATUS.acked,
        ackedAt: new Date().toISOString(),
        lastError: null,
      });
      emit({ type: 'acked', op: sending });
      continue;
    }
    if (outcome === 'superseded') {
      consecutiveTransientFailures = 0;
      sentAny = true;
      await updateOp(op.opId, { status: OP_STATUS.superseded, lastError: toLastError(error) });
      await addNotice({ kind: 'superseded', op: sending, code: error?.code ?? null });
      emit({ type: 'superseded', op: sending });
      continue;
    }
    if (outcome === 'failed') {
      sentAny = true;
      await updateOp(op.opId, { status: OP_STATUS.failed, lastError: toLastError(error) });
      await addNotice({ kind: 'failed', op: sending, code: error?.code ?? null });
      await blockDependents(op.opId);
      emit({ type: 'failed', op: sending });
      continue;
    }

    // transient or auth: the op goes back to pending with the same opId.
    await updateOp(op.opId, { status: OP_STATUS.pending, lastError: toLastError(error) });
    if (outcome === 'transient') {
      consecutiveTransientFailures += 1;
      scheduleBackoff(backoffFloorMs);
    }
    stoppedTransient = true;
    break;
  }

  if (!isCurrent()) {
    return;
  }
  if (sentAny) {
    await pullAll();
    if (!isCurrent()) {
      return;
    }
  }
  if (!stoppedTransient && getIsOnline()) {
    await recordSuccessfulSync(new Date().toISOString());
  }
  await pruneAckedOps();
}

/**
 * Starts a flush unless one is running or the device is offline.
 *
 * @param {string} reason For dev logs only.
 * @returns {Promise<void>}
 */
export function requestFlush(reason) {
  if (!engineUserId) {
    return Promise.resolve();
  }
  if (flushPromise) {
    return flushPromise;
  }
  if (!getIsOnline()) {
    return Promise.resolve();
  }
  logDev(`flush (${reason})`);
  isFlushing = true;
  emit({ type: 'flushStart' });
  flushPromise = runFlush()
    .catch((error) => logDev(`flush aborted: ${error && error.message}`))
    .finally(() => {
      flushPromise = null;
      isFlushing = false;
      emit({ type: 'flushEnd' });
    });
  return flushPromise;
}

/**
 * Pull on reconnect / app start (§8.7), then flush.
 *
 * @param {string} reason
 */
async function pullThenFlush(reason) {
  const userAtStart = engineUserId;
  await requestFlush(reason);
  if (engineUserId !== userAtStart || !getIsOnline()) {
    return;
  }
  await pullAll();
  await pruneAckedOps();
  emit({ type: 'pulled' });
}

/**
 * Resets backoff and flushes now — "Sync now", foreground and reconnect (§8.6).
 *
 * @param {string} reason
 * @returns {Promise<void>}
 */
export function syncNow(reason = 'sync-now') {
  consecutiveTransientFailures = 0;
  clearBackoff();
  return requestFlush(reason);
}

/**
 * @param {{ userId: string, getSessionEpoch: () => number }} options
 */
export function startSyncEngine({ userId, getSessionEpoch: epochGetter }) {
  stopSyncEngine();
  engineUserId = userId;
  getSessionEpoch = epochGetter;

  unsubscribeOnline = subscribeOnline((isOnline) => {
    emit({ type: 'connectivity' });
    if (isOnline) {
      consecutiveTransientFailures = 0;
      clearBackoff();
      pullThenFlush('reconnect');
    }
  });
  appStateSubscription = AppState.addEventListener('change', (nextState) => {
    if (nextState === 'active') {
      consecutiveTransientFailures = 0;
      clearBackoff();
      requestFlush('foreground');
    }
  });

  pullThenFlush('start');
}

export function stopSyncEngine() {
  engineUserId = null;
  clearBackoff();
  consecutiveTransientFailures = 0;
  pausedReason = null;
  if (unsubscribeOnline) {
    unsubscribeOnline();
    unsubscribeOnline = null;
  }
  if (appStateSubscription) {
    appStateSubscription.remove?.();
    appStateSubscription = null;
  }
}

/**
 * @returns {{ isFlushing: boolean, pausedReason: string | null }}
 */
export function getEngineStatus() {
  return { isFlushing, pausedReason };
}

/**
 * User action: Retry a failed or blocked op (§8.6) — same opId, same payload,
 * attempts reset. Its blocked dependents go back to pending with it.
 *
 * @param {string} opId
 * @returns {Promise<void>}
 */
export async function retryOp(opId) {
  const op = getOp(opId);
  if (!op || (op.status !== OP_STATUS.failed && op.status !== OP_STATUS.blocked)) {
    return;
  }
  await updateOp(opId, { status: OP_STATUS.pending, attempts: 0, lastError: null });
  for (const dependentId of collectDependents(opId, getOps())) {
    if (getOp(dependentId)?.status === OP_STATUS.blocked) {
      await updateOp(dependentId, { status: OP_STATUS.pending });
    }
  }
  await syncNow('retry');
}

/**
 * User action: Discard an op and its dependents (§8.6). Each discard is
 * recorded as a notice so the user keeps a trace.
 *
 * @param {string} opId
 * @returns {Promise<string[]>} The discarded opIds.
 */
export async function discardOp(opId) {
  const op = getOp(opId);
  if (!op) {
    return [];
  }
  const discarded = [opId, ...collectDependents(opId, getOps())];
  for (const discardedId of discarded) {
    const discardedOp = getOp(discardedId);
    if (discardedOp) {
      await addNotice({ kind: 'discarded', op: discardedOp });
    }
  }
  await removeOps(discarded);
  return discarded;
}

/**
 * User action: Edit a failed transaction op (§8.6) — replaces body/preview in
 * place, keeps the opId, sets pending.
 *
 * @param {string} opId
 * @param {{ body: object, preview: object, clientUpdatedAt: string }} replacement
 * @returns {Promise<void>}
 */
export async function replaceOpPayload(opId, replacement) {
  const op = getOp(opId);
  if (!op || (op.type !== 'transaction.create' && op.type !== 'transaction.update')) {
    return;
  }
  await updateOp(opId, {
    body: replacement.body,
    preview: replacement.preview,
    clientUpdatedAt: replacement.clientUpdatedAt,
    status: OP_STATUS.pending,
    attempts: 0,
    lastError: null,
  });
  await syncNow('edit');
}

/**
 * @param {(event: { type: string, op?: object }) => void} listener
 * @returns {() => void}
 */
export function subscribeSyncEvents(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
