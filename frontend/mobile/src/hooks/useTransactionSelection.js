import { useTransactionsStore } from '../store/useTransactionsStore';
import { useMultiSelectDelete } from './useMultiSelectDelete';

const NOUN = ['transaction', 'transactions'];

/**
 * Dashboard multi-select + bulk delete of transactions (long press to start).
 * See useMultiSelectDelete.js for the behaviour.
 */
export function useTransactionSelection() {
  const deleteTransaction = useTransactionsStore(state => state.deleteTransaction);
  return useMultiSelectDelete({ deleteOne: deleteTransaction, noun: NOUN });
}
