import { useCallback, useEffect, useState } from 'react';
import { BackHandler } from 'react-native';

/**
 * Multi-select + bulk delete — shared by the Dashboard's transaction list
 * (useTransactionSelection.js) and Split Detail's expense feed.
 *
 * - A long press starts selection mode with that row selected; while in it a
 *   tap toggles a row, and deselecting the last row leaves the mode.
 * - Android's hardware back leaves selection mode instead of the screen.
 * - `deleteSelected` runs `deleteOne` once per id, in sequence — the same
 *   per-row delete the detail screens use, so offline it queues one terminal
 *   delete op per row (ADR 0027 §5.4) and online it is one DELETE each. A failure on one row
 *   does not stop the rest; the failed ids stay selected so the user can retry.
 *
 * @returns {{
 *   isSelecting: boolean,
 *   selectedIds: Set<string>,
 *   isDeleting: boolean,
 *   deleteError: string | null,
 *   startSelection: (id: string) => void,
 *   toggle: (id: string) => void,
 *   clear: () => void,
 *   deleteSelected: () => Promise<void>,
 * }}
 */
/**
 * @param {{ deleteOne: (id: string) => Promise<{ success: boolean, error: string | null }>,
 *   noun?: [string, string] }} options `noun` is the singular/plural used in
 *   the fallback error copy.
 */
export function useMultiSelectDelete({ deleteOne, noun = ['item', 'items'] }) {
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState(null);
  const isSelecting = selectedIds.size > 0;

  const clear = useCallback(() => {
    setSelectedIds(new Set());
    setDeleteError(null);
  }, []);

  const startSelection = useCallback(id => {
    setDeleteError(null);
    setSelectedIds(current => new Set(current).add(id));
  }, []);

  const toggle = useCallback(id => {
    setSelectedIds(current => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  useEffect(() => {
    if (!isSelecting) {
      return undefined;
    }
    const subscription = BackHandler.addEventListener(
      'hardwareBackPress',
      () => {
        clear();
        return true;
      },
    );
    return () => subscription.remove();
  }, [isSelecting, clear]);

  const deleteSelected = useCallback(async () => {
    setIsDeleting(true);
    setDeleteError(null);
    const failed = new Set();
    let firstError = null;
    for (const id of selectedIds) {
      const result = await deleteOne(id);
      if (!result.success) {
        failed.add(id);
        firstError = firstError ?? result.error;
      }
    }
    setIsDeleting(false);
    setSelectedIds(failed);
    if (failed.size > 0) {
      setDeleteError(
        firstError ??
          `${failed.size} ${
            failed.size === 1 ? noun[0] : noun[1]
          } could not be deleted.`,
      );
    }
  }, [selectedIds, deleteOne, noun]);

  return {
    isSelecting,
    selectedIds,
    isDeleting,
    deleteError,
    startSelection,
    toggle,
    clear,
    deleteSelected,
  };
}
