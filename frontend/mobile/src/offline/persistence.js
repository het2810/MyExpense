import { readAllCaches, writeCache } from './cacheStore';
import { loadOutbox, clearOutboxMemory } from './outbox';
import { loadNotices, clearNoticesMemory } from './notices';
import { PERSIST_DEBOUNCE_MS } from './config';

/**
 * Store <-> disk binding —
 * docs/decisions/0027-offline-first-local-cache-and-replay-sync.md §8.4/§8.8.
 *
 * A server-backed store registers a descriptor at module scope:
 *
 *   bindStorePersistence(useXStore, {
 *     storeKey,                 // one of CACHE_SCHEMA_VERSIONS' keys
 *     watch: (state) => [...],  // the snapshot fields; a change schedules a write
 *     select: (state) => data,  // what is written (caps applied here)
 *     pull: () => Promise,      // the store's loader with { force: true } (§8.7)
 *     pullOrder: number,        // §8.7's order; lower runs first
 *   });
 *
 * and implements `hydrateFromCache(data, fetchStartedAt)` itself (§8.8).
 *
 * Writes are debounced (500 ms), only happen while an account is active, and
 * only for a snapshot that came from the network (`hasLoaded && !isFromCache`)
 * — re-writing what was just read from disk is wasted I/O.
 *
 * Layer rule: never imports React or a store; stores register here
 * (dependency inversion, the `registerSignOutReset` pattern).
 */

/** @type {Map<string, { store: object, descriptor: object }>} */
const bindings = new Map();
/** @type {Map<string, ReturnType<typeof setTimeout>>} */
const pendingWrites = new Map();
let activeUserId = null;

/**
 * @param {unknown[]} left
 * @param {unknown[]} right
 * @returns {boolean}
 */
function shallowEqualArrays(left, right) {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((value, position) => Object.is(value, right[position]));
}

/**
 * @param {object} state
 * @returns {boolean}
 */
function isPersistable(state) {
  return Boolean(state.hasLoaded) && !state.isFromCache;
}

/**
 * @param {string} storeKey
 */
function scheduleWrite(storeKey) {
  if (!activeUserId) {
    return;
  }
  const existing = pendingWrites.get(storeKey);
  if (existing) {
    clearTimeout(existing);
  }
  const userId = activeUserId;
  const timer = setTimeout(() => {
    pendingWrites.delete(storeKey);
    writeNow(storeKey, userId);
  }, PERSIST_DEBOUNCE_MS);
  pendingWrites.set(storeKey, timer);
}

/**
 * @param {string} storeKey
 * @param {string} userId
 */
function writeNow(storeKey, userId) {
  const binding = bindings.get(storeKey);
  if (!binding || activeUserId !== userId) {
    return;
  }
  const state = binding.store.getState();
  if (!isPersistable(state)) {
    return;
  }
  const data = binding.descriptor.select(state);
  writeCache(userId, storeKey, data, state.fetchStartedAt ?? null).catch((error) => {
    // A failed cache write costs an offline view later, never data: the
    // server still has it. Code only, never the value (§10.4).
    if (__DEV__) {
      console.log(`[offline] cache write failed for ${storeKey}: ${error && error.message}`);
    }
  });
}

/**
 * @param {object} store A Zustand store (`create(...)` result).
 * @param {{ storeKey: string, watch: (state: object) => unknown[],
 *   select: (state: object) => unknown, pull?: () => Promise<void>,
 *   pullOrder?: number }} descriptor
 */
export function bindStorePersistence(store, descriptor) {
  bindings.set(descriptor.storeKey, { store, descriptor });
  store.subscribe((state, previousState) => {
    if (!activeUserId || !isPersistable(state)) {
      return;
    }
    const changed =
      state.fetchStartedAt !== previousState.fetchStartedAt ||
      state.isFromCache !== previousState.isFromCache ||
      !shallowEqualArrays(descriptor.watch(state), descriptor.watch(previousState));
    if (changed) {
      scheduleWrite(descriptor.storeKey);
    }
  });
}

/**
 * Local and fast: reads every cache key for the account in one batch, loads
 * and recovers the outbox and notices, and hands each store its snapshot
 * (§8.4). A store that already holds a network snapshot this session keeps it.
 *
 * @param {string} userId
 * @returns {Promise<void>}
 */
export async function hydrateAccount(userId) {
  activeUserId = userId;

  let caches = {};
  try {
    caches = await readAllCaches(userId);
  } catch {
    caches = {};
  }
  if (activeUserId !== userId) {
    return;
  }

  bindings.forEach(({ store }, storeKey) => {
    const state = store.getState();
    const cached = caches[storeKey];
    if (state.hasLoaded && !state.isFromCache) {
      // Loaded from the network before hydration finished: persist it.
      scheduleWrite(storeKey);
      return;
    }
    if (cached && typeof state.hydrateFromCache === 'function') {
      state.hydrateFromCache(cached.data, cached.fetchStartedAt);
    }
  });

  try {
    await loadOutbox(userId);
    await loadNotices(userId);
  } catch (error) {
    if (__DEV__) {
      console.log(`[offline] outbox load failed: ${error && error.message}`);
    }
  }
}

/**
 * Sign-out: stop writing and forget the in-memory outbox and notices. The disk
 * wipe itself is `cacheStore.wipeAccount` (§8.10).
 *
 * @returns {string | null} The account that was active.
 */
export function deactivatePersistence() {
  const previousUserId = activeUserId;
  activeUserId = null;
  pendingWrites.forEach((timer) => clearTimeout(timer));
  pendingWrites.clear();
  clearOutboxMemory();
  clearNoticesMemory();
  return previousUserId;
}

/**
 * @returns {string | null}
 */
export function getActiveAccountId() {
  return activeUserId;
}

/**
 * The `fetchStartedAt` of a store's snapshot, or `undefined` when the store
 * holds no snapshot at all. The overlay's activity rule and the engine's
 * acked-op pruning both read it (§8.8).
 *
 * @param {string} storeKey
 * @returns {string | null | undefined}
 */
export function getSnapshotFetchStartedAt(storeKey) {
  const binding = bindings.get(storeKey);
  if (!binding) {
    return undefined;
  }
  const state = binding.store.getState();
  if (!state.hasLoaded) {
    return undefined;
  }
  return state.fetchStartedAt ?? null;
}

/**
 * Pull (§8.7): each registered store's loader with `force: true`, in order.
 * Only stores that already hold a snapshot are pulled — a store nobody has
 * opened yet still loads at its point of use, as before, rather than putting
 * a dozen requests in front of the first screen. Loaders own their own error
 * handling; a failure here never throws.
 *
 * @returns {Promise<void>}
 */
export async function pullAll() {
  const ordered = [...bindings.values()]
    .filter(({ descriptor }) => typeof descriptor.pull === 'function')
    .sort((left, right) => (left.descriptor.pullOrder ?? 99) - (right.descriptor.pullOrder ?? 99));

  for (const { store, descriptor } of ordered) {
    if (!store.getState().hasLoaded) {
      continue;
    }
    try {
      await descriptor.pull();
    } catch {
      // Loaders surface their own errors; a pull is best-effort.
    }
  }
}
