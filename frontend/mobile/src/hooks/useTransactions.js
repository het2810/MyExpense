import { useCallback, useEffect } from 'react';
import { useTransactionsStore } from '../store/useTransactionsStore';
import { useTransactionsView } from './useTransactionsView';

/**
 * The single entry point to the account's transactions — `GET`/`POST
 * /api/v1/transactions` and `PATCH`/`DELETE /api/v1/transactions/{id}`
 * (docs/api/api-overview.md §4) — for the surfaces that read or write the
 * list: the Dashboard, Add Expense (create and edit), and
 * `useRecentCategories` through the store it already reads.
 *
 * **This hook is the load trigger**, the same arrangement as
 * `useCategories`/`useUserSettings`/`useCurrentUserProfile`. The loader is
 * cache-first and single-flight, so every surface that mounts shares one
 * page-0 request per session unless `reload()` asks for another.
 *
 * It owns no business logic of its own, deliberately: request building lives
 * in `utils/transactionRequests.js` and orchestration in the store, so this is
 * the thin seam that keeps screens out of `src/api/` (ADR 0016 §1) and gives
 * the three of them one shape to read.
 *
 * ---
 * **`hasMore` and `loadMore` are the pagination surface, and they matter.**
 *
 * §4.1 is paginated (20 rows a page) while every consumer reads a flat array,
 * so the store accumulates pages and this hook exposes "is there another one"
 * plus "fetch it". The Dashboard drives `loadMore` from its list reaching the
 * end. **While `hasMore` is true the Dashboard's derived totals are computed
 * over loaded rows only** — see the store's own pagination note for why that
 * gap exists (there is no aggregate endpoint in §4 or §5) and what would close
 * it.
 *
 * @returns {{
 *   transactions: object[],
 *   hasLoaded: boolean,
 *   isLoading: boolean,
 *   isLoadingMore: boolean,
 *   loadError: string | null,
 *   loadMoreError: string | null,
 *   hasMore: boolean,
 *   totalElements: number,
 *   isSaving: boolean,
 *   createTransaction: (values: object) => Promise<object>,
 *   updateTransaction: (id: string, values: object) => Promise<object>,
 *   loadMore: () => void,
 *   reload: () => void,
 * }}
 */
export function useTransactions() {
  // Snapshot + queued writes (ADR 0027 §8.8) — identical to the snapshot
  // while the outbox is empty.
  const transactions = useTransactionsView();
  const hasLoaded = useTransactionsStore((state) => state.hasLoaded);
  const isLoading = useTransactionsStore((state) => state.isLoading);
  const isLoadingMore = useTransactionsStore((state) => state.isLoadingMore);
  const loadError = useTransactionsStore((state) => state.loadError);
  const loadMoreError = useTransactionsStore((state) => state.loadMoreError);
  const loadedPage = useTransactionsStore((state) => state.loadedPage);
  const totalPages = useTransactionsStore((state) => state.totalPages);
  const totalElements = useTransactionsStore((state) => state.totalElements);
  const isSaving = useTransactionsStore((state) => state.isSaving);
  const loadTransactions = useTransactionsStore((state) => state.loadTransactions);
  const loadMoreTransactions = useTransactionsStore((state) => state.loadMoreTransactions);
  const createTransaction = useTransactionsStore((state) => state.createTransaction);
  const updateTransaction = useTransactionsStore((state) => state.updateTransaction);

  useEffect(() => {
    // A no-op once a read has succeeded; after a failure `hasLoaded` is still
    // false, so re-entering the screen retries. Same effect, same reasoning as
    // `useCategories`'.
    loadTransactions();
  }, [loadTransactions]);

  const loadMore = useCallback(() => {
    loadMoreTransactions();
  }, [loadMoreTransactions]);

  const reload = useCallback(() => {
    loadTransactions({ force: true });
  }, [loadTransactions]);

  return {
    transactions,
    hasLoaded,
    isLoading,
    isLoadingMore,
    loadError,
    loadMoreError,
    hasMore: hasLoaded && loadedPage + 1 < totalPages,
    totalElements,
    isSaving,
    createTransaction,
    updateTransaction,
    loadMore,
    reload,
  };
}
