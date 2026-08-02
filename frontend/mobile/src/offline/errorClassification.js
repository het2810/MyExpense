import {
  BACKOFF_BASE_MS,
  BACKOFF_MAX_MS,
  RATE_LIMIT_BACKOFF_FLOOR_MS,
} from './config';

/**
 * Pure classification of one queued request's result —
 * docs/decisions/0027-offline-first-local-cache-and-replay-sync.md §8.6.
 *
 * | Result                                         | Outcome       |
 * |------------------------------------------------|---------------|
 * | success (no error)                             | `acked`       |
 * | `404 *_NOT_FOUND` on a DELETE                  | `acked`       |
 * | `409 ALREADY_A_MEMBER` on `group.addMember`    | `acked`       |
 * | `409 WRITE_SUPERSEDED`                         | `superseded`  |
 * | `status: 0`, any 5xx                           | `transient`   |
 * | `429`                                          | `transient` (30 s floor) |
 * | `401` (after apiClient's own refresh + retry)  | `auth`        |
 * | any other 4xx                                  | `failed`      |
 *
 * A permanent failure never blocks the queue — only its dependents.
 */

/**
 * @param {object} op
 * @param {{ status?: number, code?: string } | null | undefined} error null on success.
 * @returns {{ outcome: 'acked' | 'superseded' | 'transient' | 'auth' | 'failed',
 *   backoffFloorMs: number }}
 */
export function classify(op, error) {
  if (!error) {
    return { outcome: 'acked', backoffFloorMs: 0 };
  }
  const status = typeof error.status === 'number' ? error.status : 0;
  const code = typeof error.code === 'string' ? error.code : '';

  if (status === 0 || status >= 500) {
    return { outcome: 'transient', backoffFloorMs: 0 };
  }
  if (status === 429) {
    return { outcome: 'transient', backoffFloorMs: RATE_LIMIT_BACKOFF_FLOOR_MS };
  }
  if (status === 401) {
    return { outcome: 'auth', backoffFloorMs: 0 };
  }
  if (status === 409 && code === 'WRITE_SUPERSEDED') {
    return { outcome: 'superseded', backoffFloorMs: 0 };
  }
  if (status === 404 && op.method === 'DELETE' && code.endsWith('_NOT_FOUND')) {
    return { outcome: 'acked', backoffFloorMs: 0 };
  }
  if (status === 409 && code === 'ALREADY_A_MEMBER' && op.type === 'group.addMember') {
    return { outcome: 'acked', backoffFloorMs: 0 };
  }
  return { outcome: 'failed', backoffFloorMs: 0 };
}

/**
 * `min(5 min, 2 s × 2^failures)` with full jitter, never below `floorMs`.
 * `random` is injectable for tests. Jitter is not an id, so a non-CSPRNG
 * source is fine here (ids.js is the only place that rule applies).
 *
 * @param {number} consecutiveTransientFailures
 * @param {{ floorMs?: number, random?: () => number }} [options]
 * @returns {number} milliseconds
 */
export function computeBackoffMs(consecutiveTransientFailures, { floorMs = 0, random = Math.random } = {}) {
  const exponent = Math.max(0, consecutiveTransientFailures);
  const ceiling = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** exponent);
  const jittered = Math.floor(random() * ceiling);
  return Math.max(floorMs, jittered);
}

/**
 * The user-facing reason saved on a failed op (`lastError`). Messages come
 * from errorMessages.js at render time; only status/code are stored, plus the
 * server's message as a last resort. Never a body.
 *
 * @param {{ status?: number, code?: string, message?: string } | null} error
 * @returns {{ status: number, code: string, message: string } | null}
 */
export function toLastError(error) {
  if (!error) {
    return null;
  }
  return {
    status: typeof error.status === 'number' ? error.status : 0,
    code: typeof error.code === 'string' ? error.code : 'UNKNOWN',
    message: typeof error.message === 'string' ? error.message : '',
  };
}
