import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * The ONLY importer of AsyncStorage —
 * docs/decisions/0027-offline-first-local-cache-and-replay-sync.md §1.1/§8.2.
 *
 * Everything else goes through these functions, so replacing the library (for
 * example with an encrypted store, ADR 0027 §10.3) is a one-file change.
 *
 * **Never pass a token, a password, `receiptSignedUrl`, `paymentMethodDisplay`
 * or `paymentMethodUpiId` to this module** (§8.3/§10.3). Credentials live in
 * the keychain (`api/tokenStorage.js`) and nowhere else.
 *
 * Values are JSON. A value that fails to parse is treated as absent: a corrupt
 * cache entry must degrade to "load from the network", never to a crash.
 *
 * Logging: never log a value read or written here (§10.4) — keys only, and
 * only in dev builds.
 *
 * `getManyJson` is a sixth function beyond §8.2's five: hydration reads every
 * key for an account "in one multiGet" (§8.4), which needs it.
 */

/**
 * @param {string | null} raw
 * @returns {unknown}
 */
function parseOrNull(raw) {
  if (raw == null) {
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * @param {string} key
 * @returns {Promise<unknown>} The parsed value, or null when absent or unreadable.
 */
export async function getJson(key) {
  const raw = await AsyncStorage.getItem(key);
  return parseOrNull(raw);
}

/**
 * @param {string[]} keys
 * @returns {Promise<Record<string, unknown>>} key -> parsed value (null when absent).
 */
export async function getManyJson(keys) {
  if (keys.length === 0) {
    return {};
  }
  const rawByKey = await AsyncStorage.getMany(keys);
  const result = {};
  keys.forEach((key) => {
    result[key] = parseOrNull(rawByKey?.[key] ?? null);
  });
  return result;
}

/**
 * @param {string} key
 * @param {unknown} value Must be JSON-serializable.
 * @returns {Promise<void>}
 */
export async function setJson(key, value) {
  await AsyncStorage.setItem(key, JSON.stringify(value));
}

/**
 * @param {string} key
 * @returns {Promise<void>}
 */
export async function remove(key) {
  await AsyncStorage.removeItem(key);
}

/**
 * @param {string} prefix
 * @returns {Promise<string[]>}
 */
export async function getKeysWithPrefix(prefix) {
  const keys = await AsyncStorage.getAllKeys();
  return (keys || []).filter((key) => key.startsWith(prefix));
}

/**
 * @param {string[]} keys
 * @returns {Promise<void>}
 */
export async function multiRemove(keys) {
  if (keys.length === 0) {
    return;
  }
  await AsyncStorage.removeMany(keys);
}
