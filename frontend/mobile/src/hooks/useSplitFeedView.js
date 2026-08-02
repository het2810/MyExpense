import { useCallback, useEffect, useMemo } from 'react';
import { useSplitFeedStore } from '../store/useSplitFeedStore';
import { overlaySplitFeed } from '../offline/overlays/splitFeed';
import { groupSplitFeedByDay } from '../utils/transactionDayGroups';
import { toFeedTargetKey } from '../utils/splitFeed';
import { useActiveOps } from './useActiveOps';
import { useUserIdentity } from './useUserIdentity';

const EMPTY_ITEMS = [];
const PENDING_PAIR_PREFIX = 'pending-contact:';

/**
 * One group's or one pair's feed for Split Detail —
 * docs/decisions/0028-split-expense-edit-delete-feeds-and-balance-copy.md
 * §7.7/§11.2: the cached snapshot, queued ops overlaid (with this target's own
 * `fetchStartedAt`), then month sections. **This hook is the load trigger.**
 *
 * A pair created offline (`pending-contact:{id}`) has no server feed yet, so
 * only its queued items are shown.
 *
 * @param {{ groupId?: string | null, individualBalanceId?: string | null,
 *   counterpartContactId?: string | null }} target
 * @returns {{ items: object[], sections: Array<{ key: string, title: string, data: object[] }>,
 *   hasLoaded: boolean, isLoading: boolean, isLoadingMore: boolean,
 *   loadError: string | null, hasMore: boolean, reload: () => void, loadMore: () => void }}
 */
export function useSplitFeedView({ groupId = null, individualBalanceId = null, counterpartContactId = null }) {
  const targetKey = toFeedTargetKey({ groupId, individualBalanceId });
  const entry = useSplitFeedStore((state) => (targetKey ? state.targets[targetKey] : null));
  const status = useSplitFeedStore((state) => (targetKey ? state.status[targetKey] : null));
  const loadFeed = useSplitFeedStore((state) => state.loadFeed);
  const loadMoreFeed = useSplitFeedStore((state) => state.loadMoreFeed);
  const ops = useActiveOps('splitFeed', entry?.fetchStartedAt ?? null);
  const { userId, fullName } = useUserIdentity();

  const isPendingPair = Boolean(individualBalanceId?.startsWith(PENDING_PAIR_PREFIX));

  useEffect(() => {
    if (!isPendingPair) {
      loadFeed({ groupId, individualBalanceId });
    }
  }, [loadFeed, groupId, individualBalanceId, isPendingPair]);

  const reload = useCallback(() => {
    loadFeed({ groupId, individualBalanceId }, { force: true });
  }, [loadFeed, groupId, individualBalanceId]);

  const loadMore = useCallback(() => {
    loadMoreFeed({ groupId, individualBalanceId });
  }, [loadMoreFeed, groupId, individualBalanceId]);

  const snapshotItems = entry?.items ?? EMPTY_ITEMS;
  const items = useMemo(
    () =>
      overlaySplitFeed(
        snapshotItems,
        ops,
        { groupId, individualBalanceId, counterpartContactId },
        { currentUserId: userId, currentUserName: fullName },
      ),
    [snapshotItems, ops, groupId, individualBalanceId, counterpartContactId, userId, fullName],
  );
  const sections = useMemo(() => groupSplitFeedByDay(items), [items]);

  return {
    items,
    sections,
    hasLoaded: isPendingPair || Boolean(entry),
    isLoading: Boolean(status?.isLoading),
    isLoadingMore: Boolean(status?.isLoadingMore),
    loadError: status?.loadError ?? null,
    hasMore: Boolean(entry) && entry.page + 1 < entry.totalPages,
    reload,
    loadMore,
  };
}
