/**
 * Which outbox ops still change what a store's screens show —
 * docs/decisions/0027-offline-first-local-cache-and-replay-sync.md §8.8.
 *
 * > An op is active for store S if its status is `pending`, `inflight`,
 * > `failed` or `blocked`, or if it is `acked` and `ackedAt > S.fetchStartedAt`.
 *
 * That rule is the whole "replaced by server truth" mechanism: once a snapshot
 * is read *after* the server applied an op, the snapshot already contains it
 * and the op stops contributing — no double counting. `superseded` ops are
 * never active (the server kept another value).
 *
 * Pure.
 */

const UNSENT_STATUSES = new Set(['pending', 'inflight', 'failed', 'blocked']);

/**
 * @param {object} op
 * @param {string | null | undefined} fetchStartedAt The store snapshot's.
 * @returns {boolean}
 */
export function isOpActive(op, fetchStartedAt) {
  if (UNSENT_STATUSES.has(op.status)) {
    return true;
  }
  if (op.status !== 'acked' || !op.ackedAt) {
    return false;
  }
  if (!fetchStartedAt) {
    return true;
  }
  return op.ackedAt > fetchStartedAt;
}

/**
 * @param {object[]} ops All outbox ops, in queue order.
 * @param {string} storeKey
 * @param {string | null | undefined} fetchStartedAt
 * @returns {object[]} The ops that affect `storeKey` and are active for it.
 */
export function selectActiveOps(ops, storeKey, fetchStartedAt) {
  return ops.filter(
    (op) => (op.affects || []).includes(storeKey) && isOpActive(op, fetchStartedAt),
  );
}

/**
 * The row-level marker `PendingSyncChip` renders (§8.8).
 *
 * @param {object} op
 * @returns {'pending' | 'failed' | 'blocked' | null}
 */
export function toLocalSyncStatus(op) {
  if (op.status === 'pending' || op.status === 'inflight') {
    return 'pending';
  }
  if (op.status === 'failed' || op.status === 'blocked') {
    return op.status;
  }
  return null;
}

/**
 * True when the op has not reached the server yet (counts toward the
 * "{n} change(s) waiting to sync" caption).
 *
 * @param {object} op
 * @returns {boolean}
 */
export function isWaiting(op) {
  return UNSENT_STATUSES.has(op.status);
}
