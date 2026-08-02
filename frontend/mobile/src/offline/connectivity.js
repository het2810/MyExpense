import NetInfo from '@react-native-community/netinfo';

/**
 * The ONLY importer of NetInfo —
 * docs/decisions/0027-offline-first-local-cache-and-replay-sync.md §1.2/§8.2.
 *
 * Connectivity is a **hint, not a truth**: a request can still fail while this
 * says online, and the sync engine classifies that failure as transient
 * regardless (§8.6). It exists so a flush can start the moment the network
 * returns and the offline banner can show before the user's first failed
 * action.
 *
 * "Online" means connected and not known to be unreachable:
 * `isInternetReachable` is `null` while NetInfo is still probing, which must
 * not read as offline (it would flash the banner on every cold start).
 */

/** Optimistic until NetInfo answers: the loaders fail fast on their own if not. */
let isOnline = true;
let hasStarted = false;

/** @type {Set<(isOnline: boolean) => void>} */
const listeners = new Set();

/**
 * @param {{ isConnected?: boolean | null, isInternetReachable?: boolean | null } | null} state
 * @returns {boolean}
 */
function toIsOnline(state) {
  if (!state) {
    return true;
  }
  if (state.isConnected === false) {
    return false;
  }
  return state.isInternetReachable !== false;
}

/**
 * @param {boolean} next
 */
function publish(next) {
  if (next === isOnline) {
    return;
  }
  isOnline = next;
  listeners.forEach((listener) => listener(next));
}

/**
 * Starts listening to NetInfo once per app run. Safe to call repeatedly.
 */
export function startConnectivity() {
  if (hasStarted) {
    return;
  }
  hasStarted = true;
  NetInfo.addEventListener((state) => publish(toIsOnline(state)));
}

/**
 * The last known value. Synchronous, so render paths can read it.
 *
 * @returns {boolean}
 */
export function getIsOnline() {
  return isOnline;
}

/**
 * Asks NetInfo for a fresh reading (the post-auth gate uses it so a cold start
 * in airplane mode does not wait on a request that cannot succeed).
 *
 * @returns {Promise<boolean>}
 */
export async function refreshIsOnline() {
  startConnectivity();
  try {
    const state = await NetInfo.fetch();
    publish(toIsOnline(state));
  } catch {
    // NetInfo itself failing says nothing about the network; keep the last value.
  }
  return isOnline;
}

/**
 * @param {(isOnline: boolean) => void} listener
 * @returns {() => void} Unsubscribe.
 */
export function subscribeOnline(listener) {
  startConnectivity();
  listeners.add(listener);
  return () => listeners.delete(listener);
}
