import { getJson, getManyJson, setJson, getKeysWithPrefix, multiRemove } from './storage';
import { OUTBOX_SCHEMA_VERSION, storageKeys } from './config';

/**
 * The durable, sharded write queue —
 * docs/decisions/0027-offline-first-local-cache-and-replay-sync.md §8.5.
 *
 * On disk: `outbox/index` (ordered array of opIds) plus one `outbox/op/{opId}`
 * key per op. Sharding keeps every write small and makes the two-step
 * append/remove protocol below crash-safe:
 *
 * - **Append:** write `op/{opId}`, then `index`. A crash between the two
 *   leaves an orphan op, which `recoverOutbox` re-inserts.
 * - **Remove:** write `index` without the id, then remove `op/{opId}`. A crash
 *   between the two leaves an orphan op key. Recovery re-inserts only
 *   non-terminal orphans, so a non-terminal op being removed (a user Discard)
 *   is first re-written with the internal status `discarded` — a crash can then
 *   never bring a discarded change back.
 * - **Every status change is persisted before the action it describes**
 *   (`inflight` is written before the request is sent).
 * - **App killed mid-flush:** on load, `inflight` -> `pending`. The resend
 *   carries the same `Idempotency-Key`, so the server replays (§4.3).
 *
 * All mutations run through one promise chain, so two writers can never
 * interleave their `index` writes.
 *
 * The outbox is **never capped** (constitution §14 — data is never lost).
 *
 * Layer rule: never imports React or a store. Never logs an op body (§10.4).
 */

export const OP_STATUS = {
  pending: 'pending',
  inflight: 'inflight',
  failed: 'failed',
  blocked: 'blocked',
  acked: 'acked',
  superseded: 'superseded',
  /** Internal only: written just before a Discard removes the op (crash safety). */
  discarded: 'discarded',
};

const TERMINAL_STATUSES = new Set([OP_STATUS.acked, OP_STATUS.superseded, OP_STATUS.discarded]);

/**
 * @param {object} op
 * @returns {boolean}
 */
export function isTerminal(op) {
  return TERMINAL_STATUSES.has(op.status);
}

/**
 * @param {object} op
 * @returns {boolean} The op has not reached the server's final answer yet.
 */
export function isUnsynced(op) {
  return !isTerminal(op);
}

/**
 * Pure crash recovery (§8.5).
 *
 * 1. An index entry with no op record is dropped.
 * 2. An op record missing from the index is re-inserted in `createdAt` order,
 *    after the indexed ops — unless it is terminal, in which case it is a
 *    half-finished removal and is reported for deletion instead.
 * 3. `inflight` becomes `pending` (the request may or may not have reached the
 *    server; the same `Idempotency-Key` makes the resend safe).
 * 4. An op whose `v` is newer than this build understands is kept untouched and
 *    reported, so the engine can pause with "Update the app to finish syncing".
 *
 * @param {unknown} storedIndex
 * @param {Record<string, object>} opsById
 * @returns {{ index: string[], opsById: Record<string, object>, indexChanged: boolean,
 *   resetOpIds: string[], orphanKeysToRemove: string[], hasFutureVersion: boolean }}
 */
export function recoverOutbox(storedIndex, opsById) {
  const rawIndex = Array.isArray(storedIndex) ? storedIndex : [];
  const seen = new Set();
  const index = [];
  let indexChanged = !Array.isArray(storedIndex) && Object.keys(opsById).length > 0;

  rawIndex.forEach((opId) => {
    if (typeof opId === 'string' && opsById[opId] && !seen.has(opId)) {
      seen.add(opId);
      index.push(opId);
    } else {
      indexChanged = true;
    }
  });

  const orphanKeysToRemove = [];
  const orphans = Object.values(opsById)
    .filter((op) => !seen.has(op.opId))
    .sort((left, right) => String(left.createdAt).localeCompare(String(right.createdAt)));
  orphans.forEach((op) => {
    if (isTerminal(op)) {
      orphanKeysToRemove.push(op.opId);
      return;
    }
    index.push(op.opId);
    seen.add(op.opId);
    indexChanged = true;
  });

  const recovered = {};
  const resetOpIds = [];
  let hasFutureVersion = false;
  index.forEach((opId) => {
    const op = opsById[opId];
    if (typeof op.v === 'number' && op.v > OUTBOX_SCHEMA_VERSION) {
      hasFutureVersion = true;
      recovered[opId] = op;
      return;
    }
    if (op.status === OP_STATUS.inflight) {
      recovered[opId] = { ...op, status: OP_STATUS.pending };
      resetOpIds.push(opId);
      return;
    }
    recovered[opId] = op;
  });

  return {
    index,
    opsById: recovered,
    indexChanged,
    resetOpIds,
    orphanKeysToRemove,
    hasFutureVersion,
  };
}

// --- durable in-memory mirror ---------------------------------------------

let activeUserId = null;
/** @type {string[]} */
let index = [];
/** @type {Record<string, object>} */
let opsById = {};
let hasFutureVersionOps = false;
/** @type {Promise<unknown>} */
let mutationChain = Promise.resolve();
/** @type {Set<() => void>} */
const listeners = new Set();

function notify() {
  listeners.forEach((listener) => listener());
}

/**
 * Serializes every mutation. A failed mutation does not poison the chain.
 *
 * @template T
 * @param {() => Promise<T>} task
 * @returns {Promise<T>}
 */
function enqueueMutation(task) {
  const run = mutationChain.then(task, task);
  mutationChain = run.catch(() => {});
  return run;
}

/**
 * Loads and recovers one account's outbox. Called by `hydrateAccount`.
 *
 * @param {string} userId
 * @returns {Promise<void>}
 */
export function loadOutbox(userId) {
  return enqueueMutation(async () => {
    const opPrefix = storageKeys.outboxOpPrefix(userId);
    const storedIndex = await getJson(storageKeys.outboxIndex(userId));
    const opKeys = await getKeysWithPrefix(opPrefix);
    const rawOps = await getManyJson(opKeys);

    const loaded = {};
    opKeys.forEach((key) => {
      const op = rawOps[key];
      if (op && typeof op === 'object' && typeof op.opId === 'string') {
        loaded[op.opId] = op;
      }
    });

    const recovered = recoverOutbox(storedIndex, loaded);

    for (const opId of recovered.resetOpIds) {
      await setJson(storageKeys.outboxOp(userId, opId), recovered.opsById[opId]);
    }
    if (recovered.indexChanged) {
      await setJson(storageKeys.outboxIndex(userId), recovered.index);
    }
    if (recovered.orphanKeysToRemove.length > 0) {
      await multiRemove(
        recovered.orphanKeysToRemove.map((opId) => storageKeys.outboxOp(userId, opId)),
      );
    }

    activeUserId = userId;
    index = recovered.index;
    opsById = recovered.opsById;
    hasFutureVersionOps = recovered.hasFutureVersion;
    notify();
  });
}

/**
 * Forgets the in-memory mirror (sign-out). Disk is handled by `wipeAccount`.
 */
export function clearOutboxMemory() {
  activeUserId = null;
  index = [];
  opsById = {};
  hasFutureVersionOps = false;
  notify();
}

/**
 * @returns {object[]} Ops in queue order. Treat as read-only.
 */
export function getOps() {
  return index.map((opId) => opsById[opId]).filter(Boolean);
}

/**
 * @param {string} opId
 * @returns {object | null}
 */
export function getOp(opId) {
  return opsById[opId] ?? null;
}

/**
 * @returns {boolean}
 */
export function hasFutureVersionOp() {
  return hasFutureVersionOps;
}

/**
 * @returns {string | null}
 */
export function getOutboxUserId() {
  return activeUserId;
}

/**
 * Appends an op. Resolves only after both writes have completed — the store
 * reports the save as done only then (§8.5).
 *
 * @param {object} op A complete op record (see `operations/buildOp.js`).
 * @returns {Promise<void>}
 */
export function appendOp(op) {
  return enqueueMutation(async () => {
    if (!activeUserId) {
      throw new Error('No signed-in account to queue a change for.');
    }
    const userId = activeUserId;
    await setJson(storageKeys.outboxOp(userId, op.opId), op);
    const nextIndex = [...index, op.opId];
    await setJson(storageKeys.outboxIndex(userId), nextIndex);
    if (activeUserId !== userId) {
      return;
    }
    opsById = { ...opsById, [op.opId]: op };
    index = nextIndex;
    notify();
  });
}

/**
 * Persists a patch to one op, then updates memory.
 *
 * @param {string} opId
 * @param {object} patch
 * @returns {Promise<object | null>} The updated op.
 */
export function updateOp(opId, patch) {
  return enqueueMutation(async () => {
    const userId = activeUserId;
    const current = opsById[opId];
    if (!userId || !current) {
      return null;
    }
    const next = { ...current, ...patch };
    await setJson(storageKeys.outboxOp(userId, opId), next);
    if (activeUserId !== userId) {
      return null;
    }
    opsById = { ...opsById, [opId]: next };
    notify();
    return next;
  });
}

/**
 * Removes ops: index first, then the op keys (§8.5).
 *
 * @param {string[]} opIds
 * @returns {Promise<void>}
 */
export function removeOps(opIds) {
  return enqueueMutation(async () => {
    const userId = activeUserId;
    if (!userId || opIds.length === 0) {
      return;
    }
    const removing = new Set(opIds);
    for (const opId of opIds) {
      const op = opsById[opId];
      if (op && !isTerminal(op)) {
        await setJson(storageKeys.outboxOp(userId, opId), { ...op, status: OP_STATUS.discarded });
      }
    }
    const nextIndex = index.filter((opId) => !removing.has(opId));
    await setJson(storageKeys.outboxIndex(userId), nextIndex);
    await multiRemove(opIds.map((opId) => storageKeys.outboxOp(userId, opId)));
    if (activeUserId !== userId) {
      return;
    }
    const nextOps = { ...opsById };
    opIds.forEach((opId) => {
      delete nextOps[opId];
    });
    opsById = nextOps;
    index = nextIndex;
    notify();
  });
}

/**
 * @param {() => void} listener
 * @returns {() => void} Unsubscribe.
 */
export function subscribeOutbox(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
