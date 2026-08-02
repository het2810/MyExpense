import { useMemo } from 'react';
import { useCategoriesStore } from '../store/useCategoriesStore';
import { overlayCategories } from '../offline/overlays/categories';
import { useActiveOps } from './useActiveOps';

/**
 * The category tree with queued creates/edits/deletes applied (ADR 0027 §8.8).
 *
 * @returns {object[]}
 */
export function useCategoriesView() {
  const categories = useCategoriesStore((state) => state.categories);
  const fetchStartedAt = useCategoriesStore((state) => state.fetchStartedAt);
  const ops = useActiveOps('categories', fetchStartedAt);
  return useMemo(() => overlayCategories(categories, ops), [categories, ops]);
}
