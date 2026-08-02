import { sendRequest } from './httpClient';
import {
  getValidAccessToken,
  getAccessToken,
  refreshAccessToken,
  forceSessionExpired,
} from './authSession';
import { isApiError } from './apiError';

/**
 * Transport that knows about tokens — docs/decisions/0016-frontend-api-integration.md §6.3.
 *
 * Every authenticated call in every future domain goes through here. It
 * attaches `Authorization: Bearer`, and implements the one-shot 401 retry.
 *
 * **The interceptor applies only to requests issued through this function**
 * (ADR 0016 §4.5). A 401 does not always mean "token expired": POST /login
 * returns 401 for INVALID_CREDENTIALS and ACCOUNT_LOCKED, so intercepting
 * unauthenticated endpoints would turn a wrong password into a refresh
 * attempt and then a "session expired" force-logout — nonsense the user would
 * experience as the app breaking.
 *
 * Layer rule (ADR 0016 §1): may import `httpClient`, `authSession`,
 * `apiError`. Never React, never a store.
 */

/**
 * The single deliberate exception to "no automatic retries" (ADR 0016 §3.1).
 * Runs at most once per request; a 401 here is terminal.
 *
 * @param {string} path
 * @param {object} options
 * @param {string | null} token
 * @returns {Promise<object | null>}
 */
async function retryOnce(path, options, token) {
  try {
    return await sendRequest(path, { ...options, bearer: token });
  } catch (error) {
    if (isApiError(error) && error.status === 401) {
      // Retried with a token we believed was good and still rejected: the
      // session is genuinely dead. No third attempt, no loop.
      await forceSessionExpired('expired');
    }
    throw error;
  }
}

/**
 * Issues an authenticated request.
 *
 * 403 deliberately never triggers a refresh — it means
 * authenticated-but-not-permitted (security-architecture.md §4), and
 * refreshing a perfectly valid token changes nothing.
 *
 * @param {string} path
 * @param {{ method?: string, body?: object, timeoutMs?: number, signal?: AbortSignal }} [options]
 * @returns {Promise<object | null>}
 * @throws {import('./apiError').ApiError}
 */
export async function authorizedRequest(path, options = {}) {
  const token = await getValidAccessToken();

  try {
    return await sendRequest(path, { ...options, bearer: token });
  } catch (error) {
    if (!isApiError(error) || error.status !== 401) {
      throw error;
    }

    // The stale-token case, which is the detail most implementations miss
    // (ADR 0016 §6.3): another request may have completed a refresh while
    // this one was in flight, in which case our 401 is stale. Without this
    // check, that request would see no refresh in progress (it just
    // finished) and start a SECOND rotation — doubling rotation traffic
    // under concurrency, and every extra rotation is another chance to be
    // interrupted mid-flight.
    const tokenNow = getAccessToken();
    if (tokenNow && tokenNow !== token) {
      return retryOnce(path, options, tokenNow);
    }

    // Single-flight (ADR 0016 §6.3). May reject terminally, in which case
    // authSession has already wiped credentials and notified the store.
    const newToken = await refreshAccessToken();
    return retryOnce(path, options, newToken);
  }
}
