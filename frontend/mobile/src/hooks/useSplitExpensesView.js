import { useMemo } from 'react';
import { useSplitExpensesStore } from '../store/useSplitExpensesStore';
import { overlaySplitExpenses } from '../offline/overlays/splitExpenses';
import { useActiveOps } from './useActiveOps';

/**
 * One target's split-expense history with queued splits added (ADR 0027 §8.8).
 *
 * @param {{ groupId?: string | null, counterpartContactId?: string | null }} target
 * @returns {object[]}
 */
export function useSplitExpensesView({ groupId = null, counterpartContactId = null } = {}) {
  const rows = useSplitExpensesStore((state) => state.splitExpenses);
  const fetchStartedAt = useSplitExpensesStore((state) => state.fetchStartedAt);
  const ops = useActiveOps('splitExpenses', fetchStartedAt);
  return useMemo(
    () => overlaySplitExpenses(rows, ops, { groupId, counterpartContactId }),
    [rows, ops, groupId, counterpartContactId],
  );
}
