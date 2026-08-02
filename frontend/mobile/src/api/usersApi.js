import { authorizedRequest } from './apiClient';
import { USER_PATHS } from './config';

/**
 * User & Settings (Domain 2) — one thin function per wired endpoint, exactly
 * the shape authApi.js established (docs/decisions/0016-frontend-api-integration.md
 * §3.4). Contract: docs/api/api-overview.md §2.1–§2.5.
 *
 * **Every call here goes through `apiClient.authorizedRequest`.** This is the
 * first module to use it: all five of these endpoints require
 * `Authorization: Bearer <accessToken>` (`api-overview.md` §2), unlike Domain
 * 1 where six of the seven wired endpoints were `permitAll` and `logout`
 * deliberately bypassed the interceptor (ADR 0016 §3.2/§6.4). Using it is
 * what gets the bearer attached, the single-flight refresh-on-401, the
 * stale-token comparison, and the forced logout on a terminal 401 — none of
 * which may be re-implemented or worked around here.
 *
 * These functions return the parsed response and throw `ApiError` on any
 * failure. They hold no state and touch no store: that is what lets React
 * Query wrap them as `queryFn`s/`mutationFn`s later without this layer
 * changing (ADR 0016 §10).
 *
 * Layer rule (ADR 0016 §1): may import `apiClient` and `config`. Never
 * React, never a store.
 *
 * **`PATCH /users/me` (§2.2 — profile update) is deliberately not exposed
 * here.** It is live on the backend, but nothing in the app can call it yet:
 * there is no profile-edit screen, and the Currency row is still badged and
 * destination-less, so `defaultCurrencyCode` must not be sent at all. ADR
 * 0016 §3.4's rule applies — an endpoint wrapper nothing can call is dead
 * code (constitution §3.5), and it lands with the screen that needs it
 * (profile editing / currency selection), where its `null`-clears-`phone`
 * semantics (`backend/README.md` §11.7) can be exercised rather than
 * guessed at.
 */

/**
 * `GET /api/v1/users/me` -> `200 UserProfileResponse`:
 * `{ id, email, phone, firstName, lastName, emailVerified, isPremium,
 *    defaultCurrencyCode, createdAt }` (api-overview.md §2.1).
 *
 * Note this is a different, richer shape than the `UserResponse` carried in
 * the stored session (`authentication-api.md`) — it adds `phone`,
 * `isPremium` and `defaultCurrencyCode` and drops `roles`. Neither is
 * reshaped client-side (constitution §15/§30).
 *
 * @returns {Promise<object>} UserProfileResponse
 */
export function getCurrentUser() {
  return authorizedRequest(USER_PATHS.me);
}

/**
 * `GET /api/v1/users/me/settings` -> `200 UserSettingsResponse`:
 * `{ overspendingAlertsEnabled, paymentModeEnabled }` (api-overview.md §2.3).
 *
 * Side-effect-free server-side: a brand-new account has no `user_settings`
 * row and the documented defaults are returned without one being written
 * (`backend/README.md` §11.5), so this may be called freely.
 *
 * @returns {Promise<object>} UserSettingsResponse
 */
export function getUserSettings() {
  return authorizedRequest(USER_PATHS.settings);
}

/**
 * `PATCH /api/v1/users/me/settings` -> `200 UserSettingsResponse` (updated).
 *
 * Partial update (api-overview.md §2.4): send only the field being changed.
 * The response always carries **both** fields, so it — not the requested
 * value — is what callers should write into state.
 *
 * @param {{ overspendingAlertsEnabled?: boolean, paymentModeEnabled?: boolean }} changes
 * @returns {Promise<object>} UserSettingsResponse
 */
export function updateUserSettings(changes) {
  return authorizedRequest(USER_PATHS.settings, {
    method: 'PATCH',
    body: changes,
  });
}

/**
 * `PATCH /api/v1/users/me/premium` -> `200 UserProfileResponse` (updated).
 *
 * `isPremium` is required: an empty body is `400 VALIDATION_ERROR` and must
 * never be read as "switch premium off" (`backend/README.md` §11.6), which
 * is why this takes an explicit target value rather than meaning "flip".
 *
 * A boolean stub with no billing provider behind it (api-overview.md §2.5).
 *
 * @param {boolean} isPremium
 * @returns {Promise<object>} UserProfileResponse
 */
export function updatePremium(isPremium) {
  return authorizedRequest(USER_PATHS.premium, {
    method: 'PATCH',
    body: { isPremium },
  });
}
