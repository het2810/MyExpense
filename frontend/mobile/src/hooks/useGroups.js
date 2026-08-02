import { useCallback, useEffect } from 'react';
import { useGroupsStore } from '../store/useGroupsStore';
import { useGroupsView } from './useGroupsView';

/**
 * The single entry point to the groups the account belongs to —
 * `GET`/`POST /api/v1/groups` and `GET /api/v1/groups/{id}`
 * (docs/api/api-overview.md §7.1–§7.3) — for every surface that reads them: the
 * Split tab, Split Detail, Settle Up, Split Add Expense's GROUP field, New
 * Group and Add Expense's own group picker.
 *
 * **This hook is the load trigger**, the same arrangement as
 * `useCategories`/`useTransactions`. The loader is cache-first, so all six
 * surfaces share one `GET /groups` per session unless something forces a
 * reload — which matters against a 120 req/min per-user budget
 * (`backend/README.md` §6).
 *
 * It owns no business logic: orchestration (and the settlement write) lives in
 * the store, so this is the thin seam that keeps screens out of `src/api/`
 * (ADR 0016 §1).
 *
 * `reloadGroup` is exposed because a group's `yourBalance` is **shared state**:
 * it can move because another member acted, so a screen that has just written
 * something re-reads one group rather than adjusting a held number (ADR 0023
 * §1, its Frontend follow-up).
 *
 * @returns {{
 *   groups: object[],
 *   hasLoaded: boolean,
 *   isLoading: boolean,
 *   loadError: string | null,
 *   isSaving: boolean,
 *   createGroup: (values: { name: string, memberContactIds?: string[] })
 *     => Promise<object>,
 *   reload: () => void,
 *   reloadGroup: (groupId: string) => Promise<void>,
 * }}
 */
export function useGroups() {
  // Snapshot + queued creates and balance estimates (ADR 0027 §8.8).
  const groups = useGroupsView();
  const hasLoaded = useGroupsStore((state) => state.hasLoaded);
  const isLoading = useGroupsStore((state) => state.isLoading);
  const loadError = useGroupsStore((state) => state.loadError);
  const isSaving = useGroupsStore((state) => state.isSaving);
  const loadGroups = useGroupsStore((state) => state.loadGroups);
  const createGroup = useGroupsStore((state) => state.createGroup);
  const reloadGroup = useGroupsStore((state) => state.reloadGroup);

  useEffect(() => {
    loadGroups();
  }, [loadGroups]);

  const reload = useCallback(() => {
    loadGroups({ force: true });
  }, [loadGroups]);

  return {
    groups,
    hasLoaded,
    isLoading,
    loadError,
    isSaving,
    createGroup,
    reload,
    reloadGroup,
  };
}
