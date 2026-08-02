import { useMemo } from 'react';
import { useGroupsStore } from '../store/useGroupsStore';
import { overlayGroups } from '../offline/overlays/groups';
import { overlayGroupBalances } from '../offline/overlays/balances';
import { useActiveOps } from './useActiveOps';
import { useUserIdentity } from './useUserIdentity';

/**
 * Groups with queued creates added and `yourBalance` estimates applied
 * (ADR 0027 §8.8). An estimated row carries `isEstimate` and `pendingOpCount`.
 * `members[].balance` is estimated too (ADR 0028 §7.7/§8.1), which needs the
 * viewer's id to place a settlement on the right two members.
 *
 * @returns {object[]}
 */
export function useGroupsView() {
  const groups = useGroupsStore((state) => state.groups);
  const fetchStartedAt = useGroupsStore((state) => state.fetchStartedAt);
  const ops = useActiveOps('groups', fetchStartedAt);
  const { userId } = useUserIdentity();
  return useMemo(
    () => overlayGroupBalances(overlayGroups(groups, ops), ops, userId),
    [groups, ops, userId],
  );
}
