import * as tokenStorage from './tokenStorage';
import { sendRequest } from './httpClient';
import { AUTH_PATHS, REFRESH_SKEW_MS } from './config';
import { ApiError, isApiError } from './apiError';

/**
 * Token lifecycle — docs/decisions/0016-frontend-api-integration.md §6.
 *
 * Holds the session in memory (write-through to the keychain), owns the
 * single-flight refresh, and owns forced logout on a terminal 401.
 *
 * Layer rule (ADR 0016 §1): may import `httpClient`, `tokenStorage`,
 * `config`, `apiError`. **Never React, never a store, never `authApi` or
 * `apiClient`** — the last two would make the graph circular, since the
 * refresh call must not re-enter the 401 interceptor that triggers it.
 */

/** @type {import('./tokenStorage').StoredSession | null} */
let currentSession = null;

/**
 * The single-flight mutex (ADR 0016 §6.3). Non-null exactly while a refresh
 * is in flight.
 * @type {Promise<string> | null}
 */
let refreshPromise = null;

/** @type {((reason: 'expired' | 'reuse-detected') => void) | null} */
let sessionExpiredHandler = null;

/**
 * Incremented every time the session identity changes (new login, restore,
 * logout, forced logout).
 *
 * This closes a race ADR 0016 does not spell out but its §6.5 intent
 * requires: a rotation can still be in flight when the user taps Log Out. If
 * that rotation then resolved and persisted, it would write fresh credentials
 * back to the keychain *after* logout had wiped them — the UI would show a
 * signed-out user while the device silently held a live session, and the next
 * cold start would restore it. performRefresh() compares the epoch it started
 * with against the current one and discards its result if they differ.
 */
let sessionEpoch = 0;

/**
 * Dependency inversion so this module can tell the auth store that the
 * session died without importing it (ADR 0016 §6.5). `useAuthStore.js`
 * registers a handler at module initialization; the arrow still points
 * store -> api, so §1's layering rule holds literally.
 *
 * No navigation call is ever made from here — RootNavigator already renders
 * AuthStack when `isAuthenticated` goes false.
 *
 * @param {(reason: 'expired' | 'reuse-detected') => void} handler
 */
export function setSessionExpiredHandler(handler) {
  sessionExpiredHandler = handler;
}

/** @returns {import('./tokenStorage').StoredSession | null} */
export function getSession() {
  return currentSession;
}

/** @returns {string | null} */
export function getAccessToken() {
  return currentSession ? currentSession.accessToken : null;
}

/** @returns {object | null} The stored `UserResponse`. */
export function getUser() {
  return currentSession ? currentSession.user : null;
}

/**
 * True when there is no session, or the stored access token's lifetime has
 * already elapsed. Used only by the launch-time opportunistic refresh
 * (ADR 0016 §8.2 step 4) — not by request handling, which uses the skew below.
 *
 * @returns {boolean}
 */
export function isAccessTokenExpired() {
  if (!currentSession) {
    return true;
  }
  return currentSession.accessTokenExpiresAt <= Date.now();
}

/**
 * Merges an `AuthResponse` into a storable session.
 *
 * `AuthResponse` from /refresh **omits `user` entirely** (it is absent, not
 * null — docs/api/authentication-api.md §3), so the stored user must be
 * preserved rather than clobbered with `undefined`. A naive spread of the
 * response gets this wrong (ADR 0016 §6.3 step 4).
 *
 * @param {object} authResponse
 * @param {object | null} previousUser
 * @returns {import('./tokenStorage').StoredSession}
 */
function buildSession(authResponse, previousUser) {
  const user = authResponse.user === undefined ? previousUser : authResponse.user;
  return {
    accessToken: authResponse.accessToken,
    refreshToken: authResponse.refreshToken,
    // Only as good as the device clock — which is exactly why the reactive
    // 401 path in apiClient remains the source of truth (ADR 0016 §6.2).
    accessTokenExpiresAt: Date.now() + (authResponse.expiresIn || 0) * 1000,
    user: user || null,
  };
}

/**
 * Writes the session to memory and to the keychain.
 *
 * Memory first so apiClient's stale-token comparison (ADR 0016 §6.3) sees the
 * new token immediately; the keychain write is then awaited before any caller
 * is resolved.
 *
 * @param {import('./tokenStorage').StoredSession} session
 */
async function persistSession(session) {
  currentSession = session;
  try {
    await tokenStorage.saveSession(session);
  } catch (error) {
    // The in-memory session is valid and this app run can continue with it;
    // failing the user's request over a keychain write would be worse. The
    // cost is that a kill before the next successful write loses the session.
    if (__DEV__) {
      console.log('[auth] keychain write failed; session held in memory only');
    }
  }
}

/**
 * Starts a session from a login `AuthResponse`.
 *
 * @param {object} authResponse
 * @returns {Promise<import('./tokenStorage').StoredSession>}
 */
export async function startSession(authResponse) {
  sessionEpoch += 1;
  const session = buildSession(authResponse, null);
  await persistSession(session);
  return session;
}

/**
 * Loads any stored session into the in-memory cache (ADR 0016 §8.2 step 1/2).
 *
 * @returns {Promise<import('./tokenStorage').StoredSession | null>}
 */
export async function restoreSessionFromStorage() {
  sessionEpoch += 1;
  const stored = await tokenStorage.loadSession();
  currentSession = stored;
  return stored;
}

/**
 * Clears memory and the keychain without notifying the session-expired
 * handler — the deliberate user-initiated logout path, where the store
 * already knows (ADR 0016 §6.4).
 *
 * @returns {Promise<void>}
 */
export async function clearLocalSession() {
  sessionEpoch += 1;
  currentSession = null;
  // Deliberately NOT nulling refreshPromise: any rotation still in flight is
  // allowed to settle on its own, and the epoch guard in performRefresh()
  // stops it writing anything back.
  await tokenStorage.clearSession();
}

/**
 * Terminal failure (ADR 0016 §6.5). Wipes credentials and notifies the store.
 *
 * **Only ever called for an explicit 401 from the server.** Never for
 * NETWORK_UNAVAILABLE, TIMEOUT, a 5xx, or a parse failure — treating "we
 * couldn't reach the server" as "your session is invalid" would sign the user
 * out every time they opened the app in a tunnel (constitution §14).
 *
 * @param {'expired' | 'reuse-detected'} reason
 */
async function forceLogout(reason) {
  sessionEpoch += 1;
  currentSession = null;
  await tokenStorage.clearSession();
  if (sessionExpiredHandler) {
    sessionExpiredHandler(reason);
  }
}

/**
 * The one entry point apiClient has into forced logout — used when a request
 * that was already retried with a fresh token 401s again (ADR 0016 §6.3:
 * terminal, no third attempt, no loop).
 *
 * Deliberately narrow: callers cannot pass an arbitrary reason and cannot
 * reach it for a transport failure, because apiClient only calls it inside an
 * explicit `status === 401` branch.
 *
 * @param {'expired' | 'reuse-detected'} [reason]
 * @returns {Promise<void>}
 */
export async function forceSessionExpired(reason = 'expired') {
  await forceLogout(reason);
}

/**
 * @param {string} code
 * @returns {'expired' | 'reuse-detected'}
 */
function reasonForCode(code) {
  return code === 'REFRESH_TOKEN_REUSE_DETECTED' ? 'reuse-detected' : 'expired';
}

/**
 * The actual rotation. Never called directly — always through
 * refreshAccessToken() so the single-flight guarantee holds.
 *
 * @returns {Promise<string>} The new access token.
 */
async function performRefresh() {
  const epochAtStart = sessionEpoch;
  const session = currentSession;
  if (!session || !session.refreshToken) {
    await forceLogout('expired');
    throw new ApiError({
      status: 401,
      code: 'INVALID_REFRESH_TOKEN',
      message: 'No refresh token is available.',
      path: AUTH_PATHS.refresh,
    });
  }

  let authResponse;
  try {
    // Through sendRequest, NEVER authorizedRequest — /auth/refresh is
    // permitAll and routing it through the interceptor would make this
    // module re-enter itself (ADR 0016 §6.3 step 2).
    authResponse = await sendRequest(AUTH_PATHS.refresh, {
      method: 'POST',
      body: { refreshToken: session.refreshToken },
    });
  } catch (error) {
    // `sessionEpoch === epochAtStart` guards against tearing down a session
    // that replaced this one while the request was in flight.
    if (isApiError(error) && error.status === 401 && sessionEpoch === epochAtStart) {
      // INVALID_REFRESH_TOKEN / REFRESH_TOKEN_REUSE_DETECTED, and
      // defensively any other 401 from this endpoint. The session is
      // genuinely dead server-side; this is the one place credentials are
      // wiped without the user asking.
      await forceLogout(reasonForCode(error.code));
    }
    // Anything else — offline, timeout, 5xx, unparseable — rejects with the
    // credentials left intact (ADR 0016 §6.5's invariant).
    throw error;
  }

  if (sessionEpoch !== epochAtStart) {
    // The session was cleared or replaced while this rotation was in flight
    // (most likely the user tapped Log Out). Discard the new tokens instead
    // of writing them back over a session that no longer exists. The orphaned
    // refresh token simply expires server-side; logout is idempotent.
    throw new ApiError({
      status: 0,
      code: 'REQUEST_CANCELLED',
      message: 'The session changed while refreshing.',
      path: AUTH_PATHS.refresh,
    });
  }

  const nextSession = buildSession(authResponse, session.user);
  // Persist BEFORE resolving to any caller (ADR 0016 §6.3 step 3): resolving
  // first would leave a window where the app can be killed holding a
  // rotated-but-unpersisted token, which becomes REFRESH_TOKEN_REUSE_DETECTED
  // and a force-logout on the next launch.
  await persistSession(nextSession);
  return nextSession.accessToken;
}

/**
 * Single-flight refresh (ADR 0016 §6.3) — **the most correctness-critical
 * function in the API layer.**
 *
 * The backend rotates the refresh token on every successful refresh and
 * revokes the entire token family when an already-rotated token is replayed.
 * If several 401s each fired their own /refresh with the same stored token,
 * the first would succeed and the rest would be replays: the client would
 * force-log-out its own user and burn the whole session, with no attacker
 * present.
 *
 * The module-level promise is a genuine mutex here, not an approximation:
 * JavaScript in React Native is single-threaded and there is no `await`
 * between the check and the assignment below, so nothing can interleave
 * between them. One JS context per app process means no cross-process
 * locking is needed either. This is the simplest construct that is actually
 * correct (constitution §29).
 *
 * @returns {Promise<string>} The new access token.
 */
export function refreshAccessToken() {
  if (refreshPromise) {
    return refreshPromise; // join the in-flight refresh; never start a second
  }
  refreshPromise = performRefresh().finally(() => {
    refreshPromise = null;
  });
  return refreshPromise;
}

/**
 * Returns a usable access token, refreshing proactively when the current one
 * is about to expire (ADR 0016 §6.2).
 *
 * The proactive check is an optimization, not the mechanism — it removes most
 * of the concurrent-401 pressure, but device clocks can be wrong, so the
 * reactive 401 path in apiClient remains the source of truth.
 *
 * @returns {Promise<string | null>} null when there is no session at all.
 */
export async function getValidAccessToken() {
  if (!currentSession) {
    return null;
  }
  if (currentSession.accessTokenExpiresAt - Date.now() < REFRESH_SKEW_MS) {
    return refreshAccessToken();
  }
  return currentSession.accessToken;
}
