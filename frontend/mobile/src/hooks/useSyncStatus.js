import { useMemo } from 'react';
import {
  useSyncStore,
  deriveBannerState,
  countUnsyncedOps,
} from '../store/useSyncStore';
import { describeBanner } from '../utils/syncDisplay';

/**
 * Connectivity hint for online-only affordances (ADR 0027 §9).
 *
 * @returns {boolean}
 */
export function useIsOnline() {
  return useSyncStore((state) => state.isOnline);
}

/**
 * Everything the offline banner and the Sync Status screen read —
 * docs/decisions/0027-offline-first-local-cache-and-replay-sync.md §8.9.
 * Screens never import the store or `src/offline` directly.
 *
 * @returns {{
 *   banner: { message: string, actionLabel: string | null, tone: 'neutral' | 'negative' } | null,
 *   isOnline: boolean, isFlushing: boolean, pausedReason: string | null,
 *   ops: object[], notices: object[], lastSuccessfulSyncAt: string | null,
 *   unsyncedCount: number,
 *   syncNow: () => Promise<void>, retryOp: (opId: string) => Promise<void>,
 *   discardOp: (opId: string) => Promise<string[]>,
 *   getDependentsOf: (opId: string) => object[],
 *   dismissNotice: (noticeId: string) => Promise<void>,
 * }}
 */
export function useSyncStatus() {
  const ops = useSyncStore((state) => state.ops);
  const notices = useSyncStore((state) => state.notices);
  const isOnline = useSyncStore((state) => state.isOnline);
  const isFlushing = useSyncStore((state) => state.isFlushing);
  const pausedReason = useSyncStore((state) => state.pausedReason);
  const lastSuccessfulSyncAt = useSyncStore((state) => state.lastSuccessfulSyncAt);
  const syncNow = useSyncStore((state) => state.syncNow);
  const retryOp = useSyncStore((state) => state.retryOp);
  const discardOp = useSyncStore((state) => state.discardOp);
  const getDependentsOf = useSyncStore((state) => state.getDependentsOf);
  const dismissNotice = useSyncStore((state) => state.dismissNotice);

  const banner = useMemo(() => {
    const state = deriveBannerState({ isOnline, isFlushing, ops });
    const copy = describeBanner(state);
    if (pausedReason === 'update_required') {
      return { message: 'Update the app to finish syncing.', actionLabel: null, tone: 'negative' };
    }
    return copy ? { ...copy, tone: state.kind === 'failed' ? 'negative' : 'neutral' } : null;
  }, [isOnline, isFlushing, ops, pausedReason]);

  return {
    banner,
    isOnline,
    isFlushing,
    pausedReason,
    ops,
    notices,
    lastSuccessfulSyncAt,
    unsyncedCount: countUnsyncedOps(ops),
    syncNow,
    retryOp,
    discardOp,
    getDependentsOf,
    dismissNotice,
  };
}
