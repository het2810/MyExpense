import { create } from 'zustand';
import * as splitsApi from '../api/splitsApi';
import { SPLIT_FEED_PAGE_SIZE } from '../api/config';
import { getErrorMessage, isSessionTerminalError } from '../api/errorMessages';
import { bindStorePersistence } from '../offline/persistence';
import { CACHE_CAPS } from '../offline/config';
import { appendFeedPage, toFeedTargetKey } from '../utils/splitFeed';
import { getSessionEpoch, registerSignOutReset } from './signOutReset';
import { isSplitExpenseEntry, normalizeSplitExpense } from './useSplitExpensesStore';
import { CACHE_CONTRACT_STATE, keepsSnapshotOnFailure, nowIso } from './offlineStoreSupport';

/**
 * The Splitwise-style feed of **each group and each pair** —
 * `GET /groups/{id}/feed` and `GET /splits/individuals/{id}/feed`
 * (docs/api/api-overview.md §7.5/§8.2,
 * docs/decisions/0028-split-expense-edit-delete-feeds-and-balance-copy.md §7).
 *
 * Unlike `useSplitExpensesStore` (one target at a time), this store holds every
 * recently opened target side by side, because the cache *is* the store
 * (ADR 0028 §7.7): `targets[targetKey] = { items, page, totalPages,
 * fetchStartedAt, lastUsedAt }`, `targetKey` = `group:{id}` or `pair:{id}`,
 * 30 targets LRU, 200 items each. Split Expense Detail and the edit flow read
 * splits out of these items, so both work offline (§7.5).
 *
 * - **`fetchStartedAt` is per target**, and the overlay's active-op rule is
 *   evaluated per target (`hooks/useSplitFeedView.js`). The store-level
 *   `fetchStartedAt` the persistence layer and the engine's acked-op pruning
 *   read is the **oldest** target's: an acked op is pruned only once every
 *   cached target was re-read after it.
 * - **Pull** refreshes page 0 of every cached target and replaces its items;
 *   older pages load on scroll, online only (§7.7).
 * - Items are de-duplicated by `itemType + id` across pages (§7.2).
 *
 * Runtime flags (loading, errors) live in `status`, which is never persisted.
 * Reset on sign-out with the same epoch guard every per-account store uses.
 */

const INITIAL_STATE = {
  /** @type {Record<string, { items: object[], page: number, totalPages: number,
   *   fetchStartedAt: string | null, lastUsedAt: string }>} */
  targets: {},
  /** @type {Record<string, { isLoading: boolean, isLoadingMore: boolean,
   *   loadError: string | null, isFresh: boolean }>} */
  status: {},
  /** True once any target is held (from disk or the network). */
  hasLoaded: false,
  ...CACHE_CONTRACT_STATE,
};

const IDLE_STATUS = { isLoading: false, isLoadingMore: false, loadError: null, isFresh: false };

/**
 * The device's IANA zone, so a settlement's date is the user's calendar day
 * (§7.1). `null` when the runtime cannot say, which makes the server use UTC.
 *
 * @returns {string | null}
 */
function getDeviceTimeZone() {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof zone === 'string' && zone.length > 0 ? zone : null;
  } catch {
    return null;
  }
}

/**
 * @param {{ userId?: string | null, contactId?: string | null, name?: string } | null | undefined} party
 * @returns {object | null}
 */
function normalizeParty(party) {
  if (!party) {
    return null;
  }
  return { userId: party.userId ?? null, contactId: party.contactId ?? null, name: party.name ?? '' };
}

/**
 * One `SplitFeedItemResponse`, or `null` when it does not match the contract
 * (exactly one of `splitExpense`/`settlement`, §7.5). Nothing is re-sorted.
 *
 * @param {unknown} item
 * @returns {object | null}
 */
export function normalizeFeedItem(item) {
  if (!item || typeof item.id !== 'string' || typeof item.itemType !== 'string') {
    return null;
  }
  const base = {
    itemType: item.itemType,
    id: item.id,
    occurredOn: item.occurredOn ?? null,
    occurredAt: item.occurredAt ?? null,
  };
  if (item.itemType === 'split_expense' && isSplitExpenseEntry(item.splitExpense)) {
    return { ...base, splitExpense: normalizeSplitExpense(item.splitExpense), settlement: null };
  }
  if (item.itemType === 'settlement' && item.settlement && Number.isFinite(item.settlement.amount)) {
    const { settlement } = item;
    return {
      ...base,
      splitExpense: null,
      settlement: {
        ...settlement,
        groupId: settlement.groupId ?? null,
        individualBalanceId: settlement.individualBalanceId ?? null,
        initiatedByUserId: settlement.initiatedByUserId ?? null,
        // `null` on rows written before ADR 0028 (§7.4) — legacy copy.
        payer: normalizeParty(settlement.payer),
        payee: normalizeParty(settlement.payee),
      },
    };
  }
  return null;
}

/**
 * @param {Record<string, object>} targets
 * @returns {string | null} The oldest target's `fetchStartedAt`.
 */
function oldestFetchStartedAt(targets) {
  const stamps = Object.values(targets)
    .map((entry) => entry.fetchStartedAt)
    .filter(Boolean)
    .sort();
  return stamps[0] ?? null;
}

/**
 * Records one target, trimming items and LRU-evicting targets to the caps.
 *
 * @param {Record<string, object>} targets
 * @param {string} targetKey
 * @param {object} entry
 * @returns {Record<string, object>}
 */
function rememberTarget(targets, targetKey, entry) {
  const next = {
    ...targets,
    [targetKey]: {
      ...entry,
      items: entry.items.slice(0, CACHE_CAPS.splitFeedItemsPerTarget),
      lastUsedAt: nowIso(),
    },
  };
  const keys = Object.keys(next);
  if (keys.length > CACHE_CAPS.splitFeedTargets) {
    keys
      .sort((left, right) => next[left].lastUsedAt.localeCompare(next[right].lastUsedAt))
      .slice(0, keys.length - CACHE_CAPS.splitFeedTargets)
      .forEach((key) => {
        delete next[key];
      });
  }
  return next;
}

/**
 * @param {string} targetKey
 * @param {number} page
 * @returns {Promise<object>}
 */
function fetchPage(targetKey, page) {
  const options = { page, size: SPLIT_FEED_PAGE_SIZE, timeZone: getDeviceTimeZone() };
  const target = parseTargetKey(targetKey);
  return target.groupId
    ? splitsApi.fetchGroupFeed(target.groupId, options)
    : splitsApi.fetchPairFeed(target.individualBalanceId, options);
}

/**
 * The inverse of `toFeedTargetKey`.
 *
 * @param {string} targetKey
 * @returns {{ groupId?: string, individualBalanceId?: string }}
 */
function parseTargetKey(targetKey) {
  const separator = targetKey.indexOf(':');
  const id = targetKey.slice(separator + 1);
  return targetKey.startsWith('group:') ? { groupId: id } : { individualBalanceId: id };
}

/**
 * @param {object} response PageResponse
 * @returns {{ items: object[], page: number, totalPages: number }}
 */
function parsePage(response) {
  if (!response || !Array.isArray(response.content)) {
    throw new Error('The split feed response did not match the contract.');
  }
  return {
    items: response.content.map(normalizeFeedItem).filter(Boolean),
    page: Number.isFinite(response.page) ? response.page : 0,
    totalPages: Number.isFinite(response.totalPages) ? response.totalPages : 1,
  };
}

export const useSplitFeedStore = create((set, get) => {
  const setStatus = (targetKey, patch) =>
    set((state) => ({
      status: {
        ...state.status,
        [targetKey]: { ...IDLE_STATUS, ...state.status[targetKey], ...patch },
      },
    }));

  return {
    ...INITIAL_STATE,

    /**
     * Page 0 of one target. Cache-first within a session: a target already
     * re-read this session is not re-read unless `force`.
     *
     * @param {{ groupId?: string | null, individualBalanceId?: string | null }} target
     * @param {{ force?: boolean }} [options]
     * @returns {Promise<void>}
     */
    loadFeed: async (target, { force = false } = {}) => {
      const targetKey = toFeedTargetKey(target);
      if (!targetKey || targetKey.startsWith('pair:pending-contact:')) {
        return;
      }
      const current = get().status[targetKey] ?? IDLE_STATUS;
      if (current.isLoading || (current.isFresh && !force)) {
        return;
      }

      const epochAtStart = getSessionEpoch();
      const fetchStartedAt = nowIso();
      setStatus(targetKey, { isLoading: true, loadError: null });

      try {
        const parsed = parsePage(await fetchPage(targetKey, 0));
        if (getSessionEpoch() !== epochAtStart) {
          return;
        }
        set((state) => {
          const targets = rememberTarget(state.targets, targetKey, {
            items: parsed.items,
            page: 0,
            totalPages: parsed.totalPages,
            fetchStartedAt,
          });
          return {
            targets,
            hasLoaded: true,
            isFromCache: false,
            fetchStartedAt: oldestFetchStartedAt(targets),
            status: {
              ...state.status,
              [targetKey]: { ...IDLE_STATUS, isFresh: true },
            },
          };
        });
      } catch (error) {
        if (getSessionEpoch() !== epochAtStart) {
          return;
        }
        const hasSnapshot = Boolean(get().targets[targetKey]);
        if (keepsSnapshotOnFailure({ hasLoaded: hasSnapshot }, error)) {
          setStatus(targetKey, { isLoading: false });
          return;
        }
        setStatus(targetKey, {
          isLoading: false,
          loadError: isSessionTerminalError(error) ? null : getErrorMessage(error),
        });
      }
    },

    /**
     * The next page of one target, appended and de-duplicated. Online only
     * (§7.7): a failure leaves the held items alone.
     *
     * @param {{ groupId?: string | null, individualBalanceId?: string | null }} target
     * @returns {Promise<void>}
     */
    loadMoreFeed: async (target) => {
      const targetKey = toFeedTargetKey(target);
      const held = targetKey ? get().targets[targetKey] : null;
      const current = (targetKey && get().status[targetKey]) || IDLE_STATUS;
      if (!held || current.isLoading || current.isLoadingMore || held.page + 1 >= held.totalPages) {
        return;
      }

      const epochAtStart = getSessionEpoch();
      setStatus(targetKey, { isLoadingMore: true });
      try {
        const parsed = parsePage(await fetchPage(targetKey, held.page + 1));
        if (getSessionEpoch() !== epochAtStart) {
          return;
        }
        set((state) => {
          const latest = state.targets[targetKey] ?? held;
          return {
            targets: rememberTarget(state.targets, targetKey, {
              ...latest,
              items: appendFeedPage(latest.items, parsed.items),
              page: parsed.page,
              totalPages: parsed.totalPages,
            }),
            status: {
              ...state.status,
              [targetKey]: { ...IDLE_STATUS, ...state.status[targetKey], isLoadingMore: false },
            },
          };
        });
      } catch {
        if (getSessionEpoch() !== epochAtStart) {
          return;
        }
        setStatus(targetKey, { isLoadingMore: false });
      }
    },

    /**
     * Pull (§7.7): page 0 of every cached target, replacing its items.
     *
     * @returns {Promise<void>}
     */
    refreshCachedTargets: async () => {
      const keys = Object.keys(get().targets);
      for (const targetKey of keys) {
        await get().loadFeed(parseTargetKey(targetKey), { force: true });
      }
    },

    /**
     * Split Expense Detail's online refresh — `GET /split-expenses/{id}`
     * (§9.2, ADR 0028 §11.3). The fresh split replaces the embedded one in
     * every cached target that holds it. A `404` is reported, not stored: the
     * screen says "This expense was deleted." and the next feed pull brings
     * the tombstone.
     *
     * @param {string} splitExpenseId
     * @returns {Promise<{ outcome: 'updated' | 'not_found' | 'unavailable' }>}
     */
    refreshSplitExpense: async (splitExpenseId) => {
      const epochAtStart = getSessionEpoch();
      try {
        const response = await splitsApi.getSplitExpense(splitExpenseId);
        if (getSessionEpoch() !== epochAtStart || !isSplitExpenseEntry(response)) {
          return { outcome: 'unavailable' };
        }
        const fresh = normalizeSplitExpense(response);
        set((state) => {
          const targets = {};
          Object.entries(state.targets).forEach(([targetKey, entry]) => {
            targets[targetKey] = {
              ...entry,
              items: entry.items.map((item) =>
                item.itemType === 'split_expense' && item.id === splitExpenseId
                  ? { ...item, occurredOn: fresh.splitDate, splitExpense: fresh }
                  : item,
              ),
            };
          });
          return { targets };
        });
        return { outcome: 'updated' };
      } catch (error) {
        if (error?.code === 'SPLIT_EXPENSE_NOT_FOUND') {
          return { outcome: 'not_found' };
        }
        return { outcome: 'unavailable' };
      }
    },

    /** Drops everything — see signOutReset.js. */
    resetSplitFeed: () => set({ ...INITIAL_STATE }),

    /**
     * ADR 0027 §8.8: every cached target shows at once and is re-read the
     * first time it is opened this session (`isFresh` starts false).
     *
     * @param {{ targets: object }} data
     */
    hydrateFromCache: (data) => {
      if (!data || typeof data.targets !== 'object' || data.targets === null) {
        return;
      }
      const targets = {};
      Object.entries(data.targets).forEach(([targetKey, entry]) => {
        if (entry && Array.isArray(entry.items)) {
          targets[targetKey] = {
            items: entry.items.map(normalizeFeedItem).filter(Boolean),
            page: Number.isFinite(entry.page) ? entry.page : 0,
            totalPages: Number.isFinite(entry.totalPages) ? entry.totalPages : 1,
            fetchStartedAt: entry.fetchStartedAt ?? null,
            lastUsedAt: entry.lastUsedAt ?? nowIso(),
          };
        }
      });
      set((state) => ({
        targets: { ...targets, ...state.targets },
        hasLoaded: true,
        isFromCache: true,
        fetchStartedAt: oldestFetchStartedAt({ ...targets, ...state.targets }),
      }));
    },
  };
});

registerSignOutReset(() => {
  useSplitFeedStore.getState().resetSplitFeed();
});

bindStorePersistence(useSplitFeedStore, {
  storeKey: 'splitFeed',
  watch: (state) => [state.targets],
  select: (state) => ({ targets: state.targets }),
  pull: () => useSplitFeedStore.getState().refreshCachedTargets(),
  pullOrder: 9,
});
