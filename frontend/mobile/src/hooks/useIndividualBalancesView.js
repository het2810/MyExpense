import { useMemo } from 'react';
import { useIndividualSplitsStore } from '../store/useIndividualSplitsStore';
import { overlayIndividualBalances } from '../offline/overlays/balances';
import { useActiveOps } from './useActiveOps';

/**
 * Pairwise balances with queued splits/settlements estimated (ADR 0027 §8.8).
 * A pair created offline appears as an estimated row with id
 * `pending-contact:{contactId}`.
 *
 * @returns {object[]}
 */
export function useIndividualBalancesView() {
  const balances = useIndividualSplitsStore((state) => state.balances);
  const fetchStartedAt = useIndividualSplitsStore((state) => state.fetchStartedAt);
  const ops = useActiveOps('individualBalances', fetchStartedAt);
  return useMemo(() => overlayIndividualBalances(balances, ops), [balances, ops]);
}
