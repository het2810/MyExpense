import { useCallback, useEffect } from 'react';
import { useSplitExpensesStore } from '../store/useSplitExpensesStore';
import { useSplitExpensesView } from './useSplitExpensesView';

const PENDING_PAIR_PREFIX = 'pending-contact:';

/**
 * One target's itemized split-expense history —
 * `GET /api/v1/split-expenses?groupId=` or `?individualBalanceId=`
 * (docs/api/api-overview.md §9.3) — for Split Detail.
 *
 * **This hook is the load trigger**, and unlike the other load hooks in this
 * domain it takes a parameter: §9.3 requires **exactly one** of the two
 * targets, so a caller says which one it is displaying and the store holds that
 * one. A changed target clears the previous rows before fetching, so one
 * group's history can never render under another's name.
 *
 * Pass only the target that applies (`{ groupId }` **or**
 * `{ individualBalanceId }`); passing both, or neither, is a no-op rather than
 * a request the server would answer with `400 VALIDATION_ERROR`.
 *
 * @param {{ groupId?: string | null, individualBalanceId?: string | null }} target
 * @returns {{
 *   splitExpenses: object[],
 *   hasLoaded: boolean,
 *   isLoading: boolean,
 *   loadError: string | null,
 *   reload: () => void,
 * }}
 */
export function useSplitExpenses({
  groupId = null,
  individualBalanceId = null,
  counterpartContactId = null,
}) {
  // Snapshot + queued splits for this target (ADR 0027 §8.8).
  const splitExpenses = useSplitExpensesView({ groupId, counterpartContactId });
  const heldGroupId = useSplitExpensesStore((state) => state.groupId);
  const heldIndividualBalanceId = useSplitExpensesStore((state) => state.individualBalanceId);
  const hasLoaded = useSplitExpensesStore((state) => state.hasLoaded);
  const isLoading = useSplitExpensesStore((state) => state.isLoading);
  const loadError = useSplitExpensesStore((state) => state.loadError);
  const loadSplitExpenses = useSplitExpensesStore((state) => state.loadSplitExpenses);

  // An estimated pair created offline (`pending-contact:{id}`, ADR 0027 §8.8)
  // has no server row to read yet; only the queued splits are shown for it.
  const isPendingPair = Boolean(individualBalanceId?.startsWith(PENDING_PAIR_PREFIX));

  useEffect(() => {
    if (isPendingPair) {
      return;
    }
    loadSplitExpenses({ groupId, individualBalanceId });
  }, [loadSplitExpenses, groupId, individualBalanceId, isPendingPair]);

  const reload = useCallback(() => {
    loadSplitExpenses({ groupId, individualBalanceId, force: true });
  }, [loadSplitExpenses, groupId, individualBalanceId]);

  // The store holds one target at a time, and the load effect runs *after*
  // render. On the first render after a target change the held rows still
  // belong to the previous one, so they are withheld rather than shown — a
  // single frame of someone else's expenses under this heading is still a
  // false statement about who spent what.
  const isHeldTarget = heldGroupId === groupId && heldIndividualBalanceId === individualBalanceId;

  if (isPendingPair) {
    return { splitExpenses, hasLoaded: true, isLoading: false, loadError: null, reload };
  }

  return {
    splitExpenses: isHeldTarget ? splitExpenses : [],
    hasLoaded: isHeldTarget && hasLoaded,
    isLoading: isLoading || !isHeldTarget,
    loadError: isHeldTarget ? loadError : null,
    reload,
  };
}
