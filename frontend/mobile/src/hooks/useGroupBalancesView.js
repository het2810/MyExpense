import { useMemo } from 'react';
import { describeGroupDebts } from '../utils/simplifyDebts';
import { useGroupsView } from './useGroupsView';
import { useUserIdentity } from './useUserIdentity';

/**
 * One group's per-member nets and simplified debts —
 * docs/decisions/0028-split-expense-edit-delete-feeds-and-balance-copy.md
 * §8.1/§8.2/§11.1. Reads the **overlaid** groups store, so queued splits and
 * settlements are reflected (as estimates) offline.
 *
 * `hasBalances` is false when the server predates §8.1 (no
 * `members[].balance`): the Balances tab then lists names only. `error` is
 * `'unbalanced'` when the nets do not sum to zero; the UI then shows nets only
 * and never guesses transfers (§8.2 step 2).
 *
 * @param {string | null} groupId
 * @returns {{ group: object | null, members: object[], debts: object[],
 *   viewerDebts: object[], hasBalances: boolean, error: string | null }}
 */
export function useGroupBalancesView(groupId) {
  const groups = useGroupsView();
  const { userId } = useUserIdentity();
  const group = groups.find((item) => item.id === groupId) ?? null;

  return useMemo(() => ({ group, ...describeGroupDebts(group, userId) }), [group, userId]);
}
