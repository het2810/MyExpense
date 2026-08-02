import { getJson, setJson } from './storage';
import { storageKeys } from './config';

/**
 * User-facing sync notices (superseded, failed, discarded) —
 * docs/decisions/0027-offline-first-local-cache-and-replay-sync.md §8.3/§8.6/§8.9.
 * Stored at `sync/notices`, per account, and kept across a forced logout with
 * the outbox (§8.10). Also owns `sync/meta` (`lastSuccessfulSyncAt`).
 *
 * A notice holds display data only: the op type, its label, the error code.
 * Never a request body (§10.4).
 *
 * Notice ids are derived (`{kind}:{opId}`), so recording the same event twice
 * replaces rather than duplicates.
 */

let activeUserId = null;
/** @type {object[]} */
let notices = [];
let lastSuccessfulSyncAt = null;
/** @type {Set<() => void>} */
const listeners = new Set();

function notify() {
  listeners.forEach((listener) => listener());
}

/**
 * @param {string} userId
 * @returns {Promise<void>}
 */
export async function loadNotices(userId) {
  const storedNotices = await getJson(storageKeys.notices(userId));
  const storedMeta = await getJson(storageKeys.syncMeta(userId));
  activeUserId = userId;
  notices = Array.isArray(storedNotices) ? storedNotices : [];
  lastSuccessfulSyncAt =
    storedMeta && typeof storedMeta.lastSuccessfulSyncAt === 'string'
      ? storedMeta.lastSuccessfulSyncAt
      : null;
  notify();
}

export function clearNoticesMemory() {
  activeUserId = null;
  notices = [];
  lastSuccessfulSyncAt = null;
  notify();
}

/**
 * @returns {object[]} Newest first.
 */
export function getNotices() {
  return notices;
}

/**
 * @returns {string | null}
 */
export function getLastSuccessfulSyncAt() {
  return lastSuccessfulSyncAt;
}

/**
 * @param {{ kind: 'superseded' | 'failed' | 'discarded', op: object,
 *   code?: string | null }} details
 * @returns {Promise<void>}
 */
export async function addNotice({ kind, op, code = null }) {
  const userId = activeUserId;
  if (!userId) {
    return;
  }
  const notice = {
    id: `${kind}:${op.opId}`,
    kind,
    opId: op.opId,
    opType: op.type,
    label: op.preview?.label ?? null,
    code,
    createdAt: new Date().toISOString(),
  };
  const next = [notice, ...notices.filter((existing) => existing.id !== notice.id)];
  await setJson(storageKeys.notices(userId), next);
  if (activeUserId !== userId) {
    return;
  }
  notices = next;
  notify();
}

/**
 * @param {string} noticeId
 * @returns {Promise<void>}
 */
export async function dismissNotice(noticeId) {
  const userId = activeUserId;
  if (!userId) {
    return;
  }
  const next = notices.filter((notice) => notice.id !== noticeId);
  await setJson(storageKeys.notices(userId), next);
  if (activeUserId !== userId) {
    return;
  }
  notices = next;
  notify();
}

/**
 * @param {string} isoTime
 * @returns {Promise<void>}
 */
export async function recordSuccessfulSync(isoTime) {
  const userId = activeUserId;
  if (!userId) {
    return;
  }
  await setJson(storageKeys.syncMeta(userId), { lastSuccessfulSyncAt: isoTime });
  if (activeUserId !== userId) {
    return;
  }
  lastSuccessfulSyncAt = isoTime;
  notify();
}

/**
 * @param {() => void} listener
 * @returns {() => void}
 */
export function subscribeNotices(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
