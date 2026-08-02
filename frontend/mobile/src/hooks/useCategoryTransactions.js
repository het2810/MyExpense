import { useCallback, useEffect } from 'react';
import { useCategoryTransactionsStore } from '../store/useCategoryTransactionsStore';

/**
 * The single entry point to one category's transactions for one date range —
 * `GET /api/v1/transactions?categoryId=&dateFrom=&dateTo=`
 * (docs/api/api-overview.md §4.1) — for the Statistics tab's drill-down.
 *
 * **This hook is the load trigger**, the same arrangement as
 * `useTransactions`/`useCategories`. The loader is cache-first per query, so
 * returning to the same category within a session is free.
 *
 * It owns no business logic of its own, deliberately: the query is three
 * parameters the caller already holds, the orchestration is the store's, and
 * **there is no total to compute here** — the category's amount comes from
 * §14, which the Statistics tab was already holding when it pushed this screen
 * (docs/decisions/0022-statistics-expenses-by-parent-category.md §6: §14 owns
 * every total, `GET /transactions` owns every list). The only count this hook
 * exposes is `totalElements`, which is this `PageResponse`'s own and is exactly
 * what §14.1 points at for the drill-down's "N transactions".
 *
 * `hasMore`/`loadMore` are the pagination surface, as on `useTransactions`:
 * §4.1 answers 20 rows a page and the list drives `loadMore` from reaching its
 * end.
 *
 * @param {{ categoryId: string, dateFrom?: string | null,
 *   dateTo?: string | null }} query
 * @returns {{
 *   transactions: object[],
 *   totalElements: number,
 *   hasLoaded: boolean,
 *   isLoading: boolean,
 *   isLoadingMore: boolean,
 *   loadError: string | null,
 *   loadMoreError: string | null,
 *   hasMore: boolean,
 *   loadMore: () => void,
 *   reload: () => void,
 * }}
 */
export function useCategoryTransactions({ categoryId, dateFrom = null, dateTo = null }) {
  const transactions = useCategoryTransactionsStore((state) => state.transactions);
  const totalElements = useCategoryTransactionsStore((state) => state.totalElements);
  const hasLoaded = useCategoryTransactionsStore((state) => state.hasLoaded);
  const isLoading = useCategoryTransactionsStore((state) => state.isLoading);
  const isLoadingMore = useCategoryTransactionsStore((state) => state.isLoadingMore);
  const loadError = useCategoryTransactionsStore((state) => state.loadError);
  const loadMoreError = useCategoryTransactionsStore((state) => state.loadMoreError);
  const loadedPage = useCategoryTransactionsStore((state) => state.loadedPage);
  const totalPages = useCategoryTransactionsStore((state) => state.totalPages);
  const loadCategoryTransactions = useCategoryTransactionsStore(
    (state) => state.loadCategoryTransactions,
  );
  const loadMoreCategoryTransactions = useCategoryTransactionsStore(
    (state) => state.loadMoreCategoryTransactions,
  );

  useEffect(() => {
    // A no-op once this exact query has succeeded; after a failure `hasLoaded`
    // is still false, so re-entering the screen retries. A *different*
    // category or range clears the held rows first, so one category's
    // transactions are never briefly shown under another's heading.
    loadCategoryTransactions({ categoryId, dateFrom, dateTo });
  }, [loadCategoryTransactions, categoryId, dateFrom, dateTo]);

  const loadMore = useCallback(() => {
    loadMoreCategoryTransactions();
  }, [loadMoreCategoryTransactions]);

  const reload = useCallback(() => {
    loadCategoryTransactions({ categoryId, dateFrom, dateTo, force: true });
  }, [loadCategoryTransactions, categoryId, dateFrom, dateTo]);

  return {
    transactions,
    totalElements,
    hasLoaded,
    isLoading,
    isLoadingMore,
    loadError,
    loadMoreError,
    hasMore: hasLoaded && loadedPage + 1 < totalPages,
    loadMore,
    reload,
  };
}
