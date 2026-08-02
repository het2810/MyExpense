import { sendRequest } from './httpClient';
import { AUTH_PATHS, LOGOUT_TIMEOUT_MS } from './config';

/**
 * One thin function per wired endpoint —
 * docs/decisions/0016-frontend-api-integration.md §3.4.
 *
 * Only the endpoints something can actually call today are here.
 * `reset-password`, `verify-email` and `resend-verification` are deliberately
 * absent: nothing can call them yet (ADR 0016 §12/§13) and an unused wrapper
 * is dead code (constitution §3.5). They land with the features that need them.
 *
 * `POST /auth/refresh` is also deliberately not exposed here. It is issued
 * inside authSession.performRefresh(), because routing it through the
 * single-flight mutex is the whole of ADR 0016 §6.3 — a second, freely
 * callable wrapper would be a footgun that silently bypasses it.
 *
 * These functions return the parsed response and throw `ApiError` on any
 * failure. They hold no state and touch no store: that is what lets React
 * Query wrap them as `mutationFn`s in Domain 3/4 without this layer changing
 * (ADR 0016 §10).
 *
 * Layer rule (ADR 0016 §1): may import `httpClient` / `apiClient` and
 * `config`. Never React, never a store. `apiClient` is intentionally unused
 * for now — every wired auth endpoint is `permitAll` except logout, which
 * must bypass the 401 interceptor (see below).
 */

/**
 * `POST /api/v1/auth/register` -> `201 UserResponse`. Returns no tokens.
 *
 * @param {{ firstName: string, lastName: string, email: string, password: string }} payload
 * @returns {Promise<object>} UserResponse
 */
export function register({ firstName, lastName, email, password }) {
  return sendRequest(AUTH_PATHS.register, {
    method: 'POST',
    body: { firstName, lastName, email, password },
  });
}

/**
 * `POST /api/v1/auth/login` -> `200 AuthResponse` (with `user`).
 *
 * @param {{ email: string, password: string }} credentials
 * @returns {Promise<object>} AuthResponse
 */
export function login({ email, password }) {
  return sendRequest(AUTH_PATHS.login, {
    method: 'POST',
    body: { email, password },
  });
}

/**
 * `POST /api/v1/auth/logout` -> `204 No Content`.
 *
 * Uses `sendRequest` with an explicit bearer rather than `authorizedRequest`:
 * ADR 0016 §6.4 requires that a 401 here is NOT intercepted, because
 * refreshing a token so we can immediately invalidate it is absurd. The short
 * timeout is the ADR's one override — logout must not make the user wait on a
 * dead network.
 *
 * Idempotent server-side (authentication-api.md §4), so a duplicate or late
 * call is harmless.
 *
 * @param {{ accessToken: string, refreshToken: string }} session
 * @returns {Promise<null>}
 */
export function logout({ accessToken, refreshToken }) {
  return sendRequest(AUTH_PATHS.logout, {
    method: 'POST',
    bearer: accessToken,
    body: { refreshToken },
    timeoutMs: LOGOUT_TIMEOUT_MS,
  });
}

/**
 * `POST /api/v1/auth/forgot-password` -> `200 MessageResponse`.
 *
 * The response message is identical whether or not the account exists
 * (anti-enumeration — authentication-api.md §5), so it is safe to echo and
 * the server owns that wording.
 *
 * @param {string} email
 * @returns {Promise<object>} MessageResponse
 */
export function requestPasswordReset(email) {
  return sendRequest(AUTH_PATHS.forgotPassword, {
    method: 'POST',
    body: { email },
  });
}
