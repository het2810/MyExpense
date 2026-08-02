import { TRANSPORT_STATUS } from '../api/apiError';
import { getErrorMessage } from '../api/errorMessages';
import { appendOp } from '../offline/outbox';
import { requestFlush } from '../offline/syncEngine';

export { OFFLINE_WRITES_ENABLED } from '../offline/config';

/**
 * The store contract of docs/decisions/0027-offline-first-local-cache-and-replay-sync.md
 * §8.8, in one place so every server-backed store applies the same rules:
 *
 * - two extra state fields, `fetchStartedAt` and `isFromCache`;
 * - **fetch when `!hasLoaded || isFromCache || force`** — a snapshot read from
 *   disk is shown immediately but is always re-read once per session;
 * - **a `status: 0` failure with a snapshot keeps the snapshot and sets no
 *   error** — the offline banner already says why nothing refreshed. An error
 *   state is shown only when there is no snapshot at all;
 * - write actions, when `OFFLINE_WRITES_ENABLED` is on, enqueue an op and
 *   return `{ success: true, id, pending: true }` without awaiting the network.
 */

export const CACHE_CONTRACT_STATE = {
  /** When the network read behind the held snapshot began (ISO), or null. */
  fetchStartedAt: null,
  /** The snapshot came from disk and has not been re-read this session. */
  isFromCache: false,
};

/**
 * @param {{ hasLoaded: boolean, isFromCache: boolean }} state
 * @param {boolean} force
 * @returns {boolean}
 */
export function shouldFetch(state, force) {
  return !state.hasLoaded || state.isFromCache || force;
}

/**
 * @returns {string}
 */
export function nowIso() {
  return new Date().toISOString();
}

/**
 * True when a failed read should leave the held snapshot alone and show no
 * error: the server was never reached and there is something to show.
 *
 * @param {{ hasLoaded: boolean }} state
 * @param {unknown} error
 * @returns {boolean}
 */
export function keepsSnapshotOnFailure(state, error) {
  return Boolean(state.hasLoaded) && error?.status === TRANSPORT_STATUS;
}

/**
 * Appends an op durably, then asks the engine to flush. Resolves once both
 * outbox writes have completed (ADR 0027 §8.5) — only then may a screen
 * report the save as done.
 *
 * @param {object} op
 * @returns {Promise<{ success: boolean, error: string | null }>}
 */
export async function enqueueWrite(op) {
  try {
    await appendOp(op);
  } catch (error) {
    return { success: false, error: getErrorMessage(error) };
  }
  requestFlush('enqueue');
  return { success: true, error: null };
}
