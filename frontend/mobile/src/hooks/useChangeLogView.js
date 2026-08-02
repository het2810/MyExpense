import { useCallback, useEffect, useMemo } from 'react';
import { useChangeLogStore, toEntityKey } from '../store/useChangeLogStore';
import { useSyncStore } from '../store/useSyncStore';
import { overlayChangeLog } from '../offline/overlays/changeLog';

const EMPTY = [];

/**
 * One entity's change log as Transaction Detail's ACTIVITY card shows it
 * (ADR 0027 §6.6): cached server entries plus the entity's queued ops,
 * labelled "Waiting to sync". Also the load trigger.
 *
 * @param {string} entityType
 * @param {string | null | undefined} entityId
 * @returns {{ entries: object[], isLoading: boolean, loadError: string | null,
 *   hasEntries: boolean, reload: () => void, thisDeviceId: string | null }}
 */
export function useChangeLogView(entityType, entityId) {
  const entityKey = entityId ? toEntityKey(entityType, entityId) : null;
  const cached = useChangeLogStore((state) =>
    entityKey ? state.entities[entityKey]?.entries ?? EMPTY : EMPTY,
  );
  const status = useChangeLogStore((state) => (entityKey ? state.status[entityKey] : null));
  const loadEntityLog = useChangeLogStore((state) => state.loadEntityLog);
  const ops = useSyncStore((state) => state.ops);
  const thisDeviceId = useSyncStore((state) => state.deviceId);

  useEffect(() => {
    if (entityId) {
      loadEntityLog(entityType, entityId);
    }
  }, [entityType, entityId, loadEntityLog]);

  const reload = useCallback(() => {
    if (entityId) {
      loadEntityLog(entityType, entityId, { force: true });
    }
  }, [entityType, entityId, loadEntityLog]);

  const entries = useMemo(
    () => (entityId ? overlayChangeLog(cached, ops, entityId) : EMPTY),
    [cached, ops, entityId],
  );

  return {
    entries,
    isLoading: Boolean(status?.isLoading),
    loadError: status?.loadError ?? null,
    hasEntries: entries.length > 0,
    reload,
    thisDeviceId,
  };
}
