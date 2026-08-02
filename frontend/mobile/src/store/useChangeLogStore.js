import { create } from 'zustand';
import * as changeLogApi from '../api/changeLogApi';
import { getErrorMessage, isSessionTerminalError } from '../api/errorMessages';
import { bindStorePersistence } from '../offline/persistence';
import { CACHE_CAPS } from '../offline/config';
import { getSessionEpoch, registerSignOutReset } from './signOutReset';
import { CACHE_CONTRACT_STATE, keepsSnapshotOnFailure, nowIso } from './offlineStoreSupport';

/**
 * The server change log, per entity — `GET /api/v1/change-log?entityType=&entityId=`
 * and `GET /api/v1/change-log/{id}` (docs/api/api-overview.md §15.6/§15.7,
 * docs/decisions/0027-offline-first-local-cache-and-replay-sync.md §6.6).
 *
 * Replaces `useActivityLogStore`'s local-only per-transaction history as the
 * source of Transaction Detail's ACTIVITY card. That store and
 * `utils/activityLogEntries.js` are deleted in Phase C (ADR 0027 §11).
 *
 * Shape: `entities[entityKey] = { entries, fetchStartedAt, lastUsedAt }` with
 * `entityKey = '{entityType}:{entityId}'`. Cached per ADR 0027 §8.3: 100
 * entities, LRU, 50 entries each. Load state lives beside it in
 * `status[entityKey]` and is never persisted.
 *
 * Not pulled on reconnect: the log refreshes when its screen next opens (§8.7).
 */

const INITIAL_STATE = {
  /** @type {Record<string, { entries: object[], fetchStartedAt: string, lastUsedAt: string }>} */
  entities: {},
  /** @type {Record<string, { isLoading: boolean, loadError: string | null, isFromCache: boolean }>} */
  status: {},
  /** True once any entity has been read from the network (gates persistence). */
  hasLoaded: false,
  ...CACHE_CONTRACT_STATE,
};

/**
 * @param {unknown} entry
 * @returns {boolean}
 */
function isChangeLogEntry(entry) {
  return (
    entry != null &&
    typeof entry.id === 'string' &&
    typeof entry.entityType === 'string' &&
    typeof entry.operation === 'string' &&
    Array.isArray(entry.changes)
  );
}

/**
 * @param {string} entityType
 * @param {string} entityId
 * @returns {string}
 */
export function toEntityKey(entityType, entityId) {
  return `${entityType}:${entityId}`;
}

/**
 * @param {object} entities
 * @param {string} entityKey
 * @param {object[]} entries
 * @param {string} fetchStartedAt
 * @returns {object}
 */
function rememberEntity(entities, entityKey, entries, fetchStartedAt) {
  const next = {
    ...entities,
    [entityKey]: {
      entries: entries.slice(0, CACHE_CAPS.changeLogEntriesPerEntity),
      fetchStartedAt,
      lastUsedAt: nowIso(),
    },
  };
  const keys = Object.keys(next);
  if (keys.length <= CACHE_CAPS.changeLogEntities) {
    return next;
  }
  keys
    .sort((left, right) => next[left].lastUsedAt.localeCompare(next[right].lastUsedAt))
    .slice(0, keys.length - CACHE_CAPS.changeLogEntities)
    .forEach((key) => {
      delete next[key];
    });
  return next;
}

export const useChangeLogStore = create((set, get) => ({
  ...INITIAL_STATE,

  /**
   * Reads one entity's log. A cached log renders immediately and is re-read
   * once per session; offline, the cached entries stay with no error.
   *
   * @param {string} entityType
   * @param {string} entityId
   * @param {{ force?: boolean }} [options]
   * @returns {Promise<void>}
   */
  loadEntityLog: async (entityType, entityId, { force = false } = {}) => {
    if (!entityType || !entityId) {
      return;
    }
    const entityKey = toEntityKey(entityType, entityId);
    const current = get().status[entityKey];
    if (current?.isLoading) {
      return;
    }
    if (current && !current.isFromCache && !current.loadError && !force) {
      return;
    }

    const epochAtStart = getSessionEpoch();
    const fetchStartedAt = nowIso();
    const hasCached = Boolean(get().entities[entityKey]);
    set((state) => ({
      status: {
        ...state.status,
        [entityKey]: { isLoading: true, loadError: null, isFromCache: hasCached },
      },
    }));

    try {
      const response = await changeLogApi.listChangeLog({
        entityType,
        entityId,
        size: changeLogApi.CHANGE_LOG_ENTITY_PAGE_SIZE,
      });
      if (getSessionEpoch() !== epochAtStart) {
        return;
      }
      if (!response || !Array.isArray(response.content) || !response.content.every(isChangeLogEntry)) {
        throw new Error('The change-log response did not match the contract.');
      }
      set((state) => ({
        entities: rememberEntity(state.entities, entityKey, response.content, fetchStartedAt),
        status: {
          ...state.status,
          [entityKey]: { isLoading: false, loadError: null, isFromCache: false },
        },
        hasLoaded: true,
        isFromCache: false,
        fetchStartedAt,
      }));
    } catch (error) {
      if (getSessionEpoch() !== epochAtStart) {
        return;
      }
      const keepCached = keepsSnapshotOnFailure({ hasLoaded: hasCached }, error);
      set((state) => ({
        status: {
          ...state.status,
          [entityKey]: {
            isLoading: false,
            isFromCache: hasCached,
            loadError:
              keepCached || isSessionTerminalError(error) ? null : getErrorMessage(error),
          },
        },
      }));
    }
  },

  /**
   * One entry, for Change Detail. Served from any cached entity log first;
   * otherwise `GET /change-log/{id}`. Returns rather than stores.
   *
   * @param {string} id
   * @returns {Promise<{ entry: object | null, error: string | null }>}
   */
  fetchEntry: async (id) => {
    const cached = Object.values(get().entities)
      .flatMap((entity) => entity.entries)
      .find((entry) => entry.id === id);
    try {
      const response = await changeLogApi.getChangeLogEntry(id);
      if (!isChangeLogEntry(response)) {
        throw new Error('The change-log entry did not match the contract.');
      }
      return { entry: response, error: null };
    } catch (error) {
      if (cached && error?.status === 0) {
        return { entry: cached, error: null };
      }
      return {
        entry: cached ?? null,
        error: isSessionTerminalError(error) ? null : getErrorMessage(error),
      };
    }
  },

  /**
   * @param {{ entities: object }} data
   * @param {string | null} fetchStartedAt
   */
  hydrateFromCache: (data, fetchStartedAt) => {
    if (!data || typeof data.entities !== 'object' || data.entities === null) {
      return;
    }
    set({ entities: data.entities, fetchStartedAt, isFromCache: false });
  },

  resetChangeLog: () => set({ ...INITIAL_STATE }),
}));

registerSignOutReset(() => {
  useChangeLogStore.getState().resetChangeLog();
});

bindStorePersistence(useChangeLogStore, {
  storeKey: 'changeLog',
  watch: (state) => [state.entities],
  select: (state) => ({ entities: state.entities }),
});
