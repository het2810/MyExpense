import { useCallback, useState } from 'react';
import { useAuthStore } from '../store/useAuthStore';
import { useSyncStore, countUnsyncedOps } from '../store/useSyncStore';
import { describeUnsyncedSignOut } from '../utils/syncDisplay';

/**
 * Profile's Log Out with the unsynced-changes warning —
 * docs/decisions/0027-offline-first-local-cache-and-replay-sync.md §8.9.
 *
 * With nothing unsynced, Log Out behaves exactly as before. Otherwise a
 * dialog offers **Sync now** (online only: flushes, then re-checks),
 * **Sign out anyway** (destructive — the sign-out handler then wipes the
 * account's whole namespace, outbox included, §8.10) and **Cancel**.
 *
 * @returns {{
 *   requestSignOut: () => void,
 *   dialog: { visible: boolean, title: string, message: string,
 *     secondaryLabel: string | null, onSecondary: (() => void) | null,
 *     onConfirm: () => void, onCancel: () => void },
 * }}
 */
export function useSignOutGuard() {
  const logout = useAuthStore((state) => state.logout);
  const isOnline = useSyncStore((state) => state.isOnline);
  const syncNow = useSyncStore((state) => state.syncNow);
  const [unsyncedCount, setUnsyncedCount] = useState(0);
  const [isVisible, setIsVisible] = useState(false);

  const requestSignOut = useCallback(() => {
    const count = useSyncStore.getState().getUnsyncedCount();
    if (count === 0) {
      logout();
      return;
    }
    setUnsyncedCount(count);
    setIsVisible(true);
  }, [logout]);

  const handleSyncNow = useCallback(async () => {
    setIsVisible(false);
    await syncNow();
    const remaining = countUnsyncedOps(useSyncStore.getState().ops);
    if (remaining === 0) {
      logout();
      return;
    }
    setUnsyncedCount(remaining);
    setIsVisible(true);
  }, [syncNow, logout]);

  const handleConfirm = useCallback(() => {
    setIsVisible(false);
    logout();
  }, [logout]);

  const handleCancel = useCallback(() => setIsVisible(false), []);

  return {
    requestSignOut,
    dialog: {
      visible: isVisible,
      title: 'Unsynced changes',
      message: describeUnsyncedSignOut(unsyncedCount),
      secondaryLabel: isOnline ? 'Sync now' : null,
      onSecondary: isOnline ? handleSyncNow : null,
      onConfirm: handleConfirm,
      onCancel: handleCancel,
    },
  };
}
