import { useMemo } from 'react';
import { useTransactionsStore } from '../store/useTransactionsStore';
import { overlayTransactions } from '../offline/overlays/transactions';
import { useActiveOps } from './useActiveOps';

/**
 * The account's transactions as screens show them: the snapshot plus queued
 * writes (ADR 0027 §8.8). Rows from the overlay carry `localSyncStatus`.
 * Category writes affect `transactions` too (rename / reassign to Misc).
 *
 * @returns {object[]}
 */
export function useTransactionsView() {
  const rows = useTransactionsStore((state) => state.transactions);
  const fetchStartedAt = useTransactionsStore((state) => state.fetchStartedAt);
  const ops = useActiveOps('transactions', fetchStartedAt);
  return useMemo(() => overlayTransactions(rows, ops), [rows, ops]);
}
