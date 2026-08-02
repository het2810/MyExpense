import { useMemo } from 'react';
import { useBudgetStore } from '../store/useBudgetStore';
import { overlayBudget } from '../offline/overlays/budget';
import { useActiveOps } from './useActiveOps';

/**
 * The active budget period with a queued `budget.save` applied (ADR 0027 §8.8).
 * Own data, so not labelled an estimate.
 *
 * @returns {object | null}
 */
export function useBudgetView() {
  const activePeriod = useBudgetStore((state) => state.activePeriod);
  const fetchStartedAt = useBudgetStore((state) => state.fetchStartedAt);
  const ops = useActiveOps('budget', fetchStartedAt);
  return useMemo(() => overlayBudget(activePeriod, ops), [activePeriod, ops]);
}
