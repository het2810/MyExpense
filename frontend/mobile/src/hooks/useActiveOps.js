import { useMemo } from 'react';
import { useSyncStore } from '../store/useSyncStore';
import { selectActiveOps, isWaiting } from '../offline/overlays/activeOps';

/**
 * The outbox ops that still change what one store's screens show —
 * docs/decisions/0027-offline-first-local-cache-and-replay-sync.md §8.8.
 * Shared by every `use*View` hook.
 *
 * @param {string} storeKey
 * @param {string | null} fetchStartedAt The store snapshot's.
 * @returns {object[]}
 */
export function useActiveOps(storeKey, fetchStartedAt) {
  const ops = useSyncStore((state) => state.ops);
  return useMemo(
    () => selectActiveOps(ops, storeKey, fetchStartedAt),
    [ops, storeKey, fetchStartedAt],
  );
}

/**
 * How many outbox ops affecting `storeKey` have not been sent yet — the
 * Statistics "Doesn't include changes waiting to sync" condition (§8.8).
 *
 * @param {string} storeKey
 * @returns {number}
 */
export function useWaitingOpCount(storeKey) {
  const ops = useSyncStore((state) => state.ops);
  return useMemo(
    () => ops.filter((op) => (op.affects || []).includes(storeKey) && isWaiting(op)).length,
    [ops, storeKey],
  );
}
