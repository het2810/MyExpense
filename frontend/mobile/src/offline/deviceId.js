import { getJson, setJson } from './storage';
import { newId } from './ids';
import { storageKeys } from './config';

/**
 * The per-install id sent as `X-Device-Id` —
 * docs/decisions/0027-offline-first-local-cache-and-replay-sync.md §4.1/§8.3.
 *
 * Global (not per account) and kept across sign-out: it identifies the device,
 * so the change log can say "on another device". Created lazily — only the
 * sync engine asks for it, and only when it sends a queued write.
 */

/** @type {Promise<string> | null} */
let deviceIdPromise = null;

/**
 * @returns {Promise<string>}
 */
async function readOrCreate() {
  const key = storageKeys.deviceId();
  const stored = await getJson(key);
  if (typeof stored === 'string' && stored.length > 0) {
    return stored;
  }
  const created = newId();
  await setJson(key, created);
  return created;
}

/**
 * @returns {Promise<string>}
 */
export function getDeviceId() {
  if (!deviceIdPromise) {
    deviceIdPromise = readOrCreate().catch((error) => {
      // Do not cache a failure: the next call tries again.
      deviceIdPromise = null;
      throw error;
    });
  }
  return deviceIdPromise;
}

/**
 * The id if it has already been read this run, otherwise null. Lets the change
 * log compare `deviceId` synchronously without forcing a creation.
 *
 * @returns {Promise<string | null>}
 */
export async function peekDeviceId() {
  const stored = await getJson(storageKeys.deviceId());
  return typeof stored === 'string' ? stored : null;
}
