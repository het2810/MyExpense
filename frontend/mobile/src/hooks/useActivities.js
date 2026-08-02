import { useCallback, useEffect } from 'react';
import { useActivitiesStore } from '../store/useActivitiesStore';

/**
 * The single entry point to the account's activity feed —
 * `GET /api/v1/activities` (docs/api/api-overview.md §11.1) — for the global
 * Activities screen reached from Profile.
 *
 * **This hook is the load trigger**, the same arrangement as
 * `useTransactions`/`useCategories`/`useCategoryTransactions`. The loader is
 * cache-first and single-flight, so re-entering the screen within a session
 * costs nothing unless `reload()` asks for a fresh read.
 *
 * It owns no business logic of its own, deliberately: there is nothing to
 * compute. §11.1 is read-only (`activities` rows are immutable and only the
 * server's fan-out writes them), the sentences arrive pre-composed and frozen,
 * and **the order is the server's** — so this hook has no write surface, no
 * derivation and no sort. It is the thin seam that keeps the screen out of
 * `src/api/` (ADR 0016 §1).
 *
 * `hasMore`/`loadMore` are the pagination surface, as on `useTransactions`:
 * §11.1 answers 20 entries a page and the list drives `loadMore` from reaching
 * its end. `loadMoreError` is separate from `loadError` so a failed next page
 * can be reported *below* the rows instead of replacing them.
 *
 * @returns {{
 *   activities: object[],
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
export function useActivities() {
  const activities = useActivitiesStore((state) => state.activities);
  const totalElements = useActivitiesStore((state) => state.totalElements);
  const hasLoaded = useActivitiesStore((state) => state.hasLoaded);
  const isLoading = useActivitiesStore((state) => state.isLoading);
  const isLoadingMore = useActivitiesStore((state) => state.isLoadingMore);
  const loadError = useActivitiesStore((state) => state.loadError);
  const loadMoreError = useActivitiesStore((state) => state.loadMoreError);
  const loadedPage = useActivitiesStore((state) => state.loadedPage);
  const totalPages = useActivitiesStore((state) => state.totalPages);
  const loadActivities = useActivitiesStore((state) => state.loadActivities);
  const loadMoreActivities = useActivitiesStore((state) => state.loadMoreActivities);

  useEffect(() => {
    // A no-op once a read has succeeded; after a failure `hasLoaded` is still
    // false, so re-entering the screen retries. Same effect, same reasoning as
    // `useTransactions`'.
    loadActivities();
  }, [loadActivities]);

  const loadMore = useCallback(() => {
    loadMoreActivities();
  }, [loadMoreActivities]);

  const reload = useCallback(() => {
    loadActivities({ force: true });
  }, [loadActivities]);

  return {
    activities,
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
