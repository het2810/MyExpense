import { buildUrl, DEFAULT_TIMEOUT_MS } from './config';
import {
  fromErrorResponse,
  networkError,
  timeoutError,
  cancelledError,
  invalidResponseError,
} from './apiError';

/**
 * The single transport primitive — docs/decisions/0016-frontend-api-integration.md §3.1.
 *
 * **This module knows nothing about authentication.** That is the whole point
 * of ADR 0016 §1's module split: `authSession` can call POST /auth/refresh
 * through here without re-entering the 401 interceptor that triggered it,
 * which is what keeps the dependency graph acyclic.
 *
 * Layer rule (ADR 0016 §1): may import `config` and `apiError` only. Never
 * React, never a store.
 */

/**
 * Dev-only request logging — constitution §23 / ADR 0016 §14.
 * Method, path, status and error code ONLY. Never a header, never a request
 * or response body: the convenient `console.log(response)` while debugging a
 * login is exactly what puts a refresh token in a log.
 *
 * @param {string} method
 * @param {string} path
 * @param {number} status
 * @param {string} [code]
 */
function logDev(method, path, status, code) {
  if (__DEV__) {
    const suffix = code ? ` ${code}` : '';
    console.log(`[api] ${method} ${path} -> ${status}${suffix}`);
  }
}

/**
 * Reads a response body without ever letting a parser error escape.
 *
 * @param {Response} response
 * @returns {Promise<object | null>} Parsed JSON, or null when there is no body.
 * @throws {SyntaxError} Only internally — callers below convert it.
 */
async function readJsonBody(response) {
  const text = await response.text();
  if (!text) {
    return null;
  }
  return JSON.parse(text);
}

/**
 * @param {Response} response
 * @returns {boolean}
 */
function isJsonResponse(response) {
  const contentType = response.headers?.get?.('content-type') || '';
  return contentType.includes('json');
}

/**
 * Performs one HTTP request. No automatic retries (ADR 0016 §3.1) — blind
 * retries against a rate-limited API make the rate limit worse, and a
 * retried non-idempotent POST is a correctness risk. The single post-refresh
 * retry in apiClient.js is the one deliberate exception.
 *
 * @param {string} path Path relative to the API prefix, e.g. '/auth/login'.
 * @param {{ method?: string, body?: object, bearer?: string | null,
 *           timeoutMs?: number, signal?: AbortSignal }} [options]
 * @returns {Promise<object | null>} Parsed JSON, or null for `204 No Content`.
 * @throws {import('./apiError').ApiError} Every failure path, normalized.
 */
export async function sendRequest(path, options = {}) {
  const {
    method = 'GET',
    body,
    bearer,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    signal: callerSignal,
  } = options;

  const controller = new AbortController();
  let didTimeout = false;
  const timer = setTimeout(() => {
    didTimeout = true;
    controller.abort();
  }, timeoutMs);

  const abortFromCaller = () => controller.abort();
  if (callerSignal) {
    if (callerSignal.aborted) {
      controller.abort();
    } else {
      callerSignal.addEventListener('abort', abortFromCaller);
    }
  }

  const headers = { Accept: 'application/json' };
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }
  if (bearer) {
    // `tokenType` from AuthResponse is deliberately ignored (ADR 0016 §3.3) —
    // it is contractually always "Bearer", and interpolating a server-supplied
    // scheme into an auth header is not worth the flexibility.
    headers.Authorization = `Bearer ${bearer}`;
  }

  let response;
  try {
    response = await fetch(buildUrl(path), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error) {
    if (error?.name === 'AbortError') {
      if (didTimeout) {
        logDev(method, path, 0, 'TIMEOUT');
        throw timeoutError(path);
      }
      throw cancelledError(path);
    }
    // fetch only rejects for transport-level problems: offline, DNS failure,
    // connection refused. Never for an HTTP error status.
    logDev(method, path, 0, 'NETWORK_UNAVAILABLE');
    throw networkError(path);
  } finally {
    clearTimeout(timer);
    if (callerSignal) {
      callerSignal.removeEventListener?.('abort', abortFromCaller);
    }
  }

  if (!response.ok) {
    let errorBody = null;
    if (isJsonResponse(response)) {
      try {
        errorBody = await readJsonBody(response);
      } catch {
        errorBody = null;
      }
    }
    const apiError = fromErrorResponse(response.status, errorBody, path);
    logDev(method, path, response.status, apiError.code);
    throw apiError;
  }

  logDev(method, path, response.status);

  // 204 No Content is logout's success case (authentication-api.md §4).
  if (response.status === 204) {
    return null;
  }

  if (!isJsonResponse(response)) {
    // An empty 200, or an HTML page from a proxy. Normalized rather than
    // allowed to throw a bare SyntaxError into a screen (constitution §22).
    return null;
  }

  try {
    return await readJsonBody(response);
  } catch {
    throw invalidResponseError(path);
  }
}
