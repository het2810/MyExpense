import { useCallback, useEffect, useState } from 'react';
import { useChangeLogStore } from '../store/useChangeLogStore';
import { useSyncStore } from '../store/useSyncStore';

/**
 * One change-log entry for Change Detail (ADR 0027 §6.5/§6.6):
 * `GET /change-log/{id}`, falling back to a cached copy offline.
 *
 * @param {string | null | undefined} changeLogId
 * @returns {{ entry: object | null, isLoading: boolean, error: string | null,
 *   thisDeviceId: string | null, reload: () => void }}
 */
export function useChangeDetail(changeLogId) {
  const fetchEntry = useChangeLogStore((state) => state.fetchEntry);
  const thisDeviceId = useSyncStore((state) => state.deviceId);
  const [entry, setEntry] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!changeLogId) {
      return undefined;
    }
    let isCurrent = true;
    setIsLoading(true);
    setError(null);
    fetchEntry(changeLogId).then((result) => {
      if (!isCurrent) {
        return;
      }
      setIsLoading(false);
      setEntry(result.entry);
      setError(result.error);
    });
    return () => {
      isCurrent = false;
    };
  }, [changeLogId, fetchEntry, attempt]);

  const reload = useCallback(() => setAttempt((value) => value + 1), []);

  return { entry, isLoading, error, thisDeviceId, reload };
}
