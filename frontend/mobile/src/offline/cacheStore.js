import { getJson, getManyJson, setJson, getKeysWithPrefix, multiRemove } from './storage';
import { CACHE_SCHEMA_VERSIONS, storageKeys } from './config';

/**
 * Per-account snapshot envelopes —
 * docs/decisions/0027-offline-first-local-cache-and-replay-sync.md §8.3.
 *
 * Envelope: `{ v, savedAt, fetchStartedAt, data }`. `fetchStartedAt` is when
 * the **network read** that produced `data` began; the overlay's
 * "replaced by server truth" rule depends on it (§8.8).
 *
 * Versioning: an envelope whose `v` is not `CACHE_SCHEMA_VERSIONS[storeKey]`
 * is discarded (and deleted) and the store loads from the network. A cache is
 * disposable; the outbox is not, and lives in `outbox.js`.
 */

/**
 * Pure: validates one stored envelope against the current schema version.
 *
 * @param {string} storeKey
 * @param {unknown} envelope
 * @returns {{ data: unknown, fetchStartedAt: string | null } | null}
 */
export function unwrapEnvelope(storeKey, envelope) {
  const expectedVersion = CACHE_SCHEMA_VERSIONS[storeKey];
  if (expectedVersion === undefined) {
    return null;
  }
  if (!envelope || typeof envelope !== 'object' || envelope.v !== expectedVersion) {
    return null;
  }
  if (envelope.data === undefined) {
    return null;
  }
  return {
    data: envelope.data,
    fetchStartedAt: typeof envelope.fetchStartedAt === 'string' ? envelope.fetchStartedAt : null,
  };
}

/**
 * Pure: builds the envelope written to disk.
 *
 * @param {string} storeKey
 * @param {unknown} data
 * @param {string | null} fetchStartedAt
 * @param {string} savedAt
 * @returns {object}
 */
export function wrapEnvelope(storeKey, data, fetchStartedAt, savedAt) {
  return {
    v: CACHE_SCHEMA_VERSIONS[storeKey],
    savedAt,
    fetchStartedAt: fetchStartedAt ?? null,
    data,
  };
}

/**
 * @param {string} userId
 * @param {string} storeKey
 * @returns {Promise<{ data: unknown, fetchStartedAt: string | null } | null>}
 */
export async function readCache(userId, storeKey) {
  const envelope = await getJson(storageKeys.cache(userId, storeKey));
  return unwrapEnvelope(storeKey, envelope);
}

/**
 * Reads every known store's envelope for one account in a single batch.
 * Envelopes with a mismatched version are deleted so they are not re-read.
 *
 * @param {string} userId
 * @returns {Promise<Record<string, { data: unknown, fetchStartedAt: string | null }>>}
 */
export async function readAllCaches(userId) {
  const storeKeys = Object.keys(CACHE_SCHEMA_VERSIONS);
  const keys = storeKeys.map((storeKey) => storageKeys.cache(userId, storeKey));
  const rawByKey = await getManyJson(keys);

  const result = {};
  const discarded = [];
  storeKeys.forEach((storeKey, position) => {
    const key = keys[position];
    const raw = rawByKey[key];
    if (raw == null) {
      return;
    }
    const unwrapped = unwrapEnvelope(storeKey, raw);
    if (unwrapped) {
      result[storeKey] = unwrapped;
    } else {
      discarded.push(key);
    }
  });

  if (discarded.length > 0) {
    await multiRemove(discarded);
  }
  return result;
}

/**
 * @param {string} userId
 * @param {string} storeKey
 * @param {unknown} data
 * @param {string | null} fetchStartedAt
 * @returns {Promise<void>}
 */
export async function writeCache(userId, storeKey, data, fetchStartedAt) {
  const envelope = wrapEnvelope(storeKey, data, fetchStartedAt, new Date().toISOString());
  await setJson(storageKeys.cache(userId, storeKey), envelope);
}

/**
 * Sign-out wipe (ADR 0027 §8.10).
 * - `keepOutbox: true` (forced logout): caches only. The outbox and notices
 *   stay so the same user's queued changes sync after signing back in.
 * - `keepOutbox: false` (deliberate logout): the account's whole namespace.
 *
 * The global device id is outside the account prefix and is never touched.
 *
 * @param {string} userId
 * @param {{ keepOutbox: boolean }} options
 * @returns {Promise<void>}
 */
export async function wipeAccount(userId, { keepOutbox }) {
  if (!userId) {
    return;
  }
  const prefix = keepOutbox ? storageKeys.cachePrefix(userId) : storageKeys.accountPrefix(userId);
  const keys = await getKeysWithPrefix(prefix);
  await multiRemove(keys);
}
