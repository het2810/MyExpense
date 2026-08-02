import { useCallback, useEffect } from 'react';
import { useIndividualSplitsStore } from '../store/useIndividualSplitsStore';
import { useIndividualBalancesView } from './useIndividualBalancesView';

/**
 * The single entry point to the account's pairwise balances —
 * `GET /api/v1/splits/individuals` (docs/api/api-overview.md §8.1, as corrected
 * by docs/decisions/0023-shared-ledger-contract-corrections.md §1) — for the
 * Split tab's Individual list, Split Detail and Settle Up.
 *
 * **This hook is the load trigger**, cache-first and shared across those three
 * surfaces, exactly like `useGroups`.
 *
 * ---
 * **`balance` IS ALREADY ORIENTED TO THE CALLER — CONSUMERS NEVER NEGATE IT.**
 *
 * Positive = you are owed, negative = you owe, for every row and in both
 * directions. The flip that makes that true happens once, server-side, when the
 * caller is the canonical counterpart of the pair. Stated here as well as in
 * the store because this is the layer screens read.
 *
 * ---
 * **THESE ROWS ARE SHARED, SO `reload` IS NOT JUST A RETRY.** A pairwise
 * balance is one row that both parties read and settle, so it can change with
 * no action on this device. Every write in the flow re-reads instead of
 * adjusting a held value, and this is the function that does it.
 *
 * @returns {{
 *   balances: object[],
 *   hasLoaded: boolean,
 *   isLoading: boolean,
 *   loadError: string | null,
 *   reload: () => void,
 * }}
 */
export function useIndividualBalances() {
  // Snapshot + queued split/settlement estimates (ADR 0027 §8.8).
  const balances = useIndividualBalancesView();
  const hasLoaded = useIndividualSplitsStore((state) => state.hasLoaded);
  const isLoading = useIndividualSplitsStore((state) => state.isLoading);
  const loadError = useIndividualSplitsStore((state) => state.loadError);
  const loadIndividualBalances = useIndividualSplitsStore(
    (state) => state.loadIndividualBalances,
  );

  useEffect(() => {
    loadIndividualBalances();
  }, [loadIndividualBalances]);

  const reload = useCallback(() => {
    loadIndividualBalances({ force: true });
  }, [loadIndividualBalances]);

  return {
    balances,
    hasLoaded,
    isLoading,
    loadError,
    reload,
  };
}
