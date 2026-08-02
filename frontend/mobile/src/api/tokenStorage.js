import * as Keychain from 'react-native-keychain';

/**
 * OS-level secure storage for the auth session —
 * docs/decisions/0016-frontend-api-integration.md §5.
 *
 * **This is the only file in the app that may import `react-native-keychain`
 * (ADR 0016 §5.2).** The surface used is three functions; if the library ever
 * needs replacing, it is a one-file rewrite behind this unchanged interface.
 * Plaintext AsyncStorage was explicitly rejected for a finance app holding a
 * 30-day refresh token.
 *
 * Layer rule (ADR 0016 §1): may import the keychain library only. Never
 * React, never a store, never another api/ module.
 */

const SERVICE = 'com.myexpense.auth';

// The library's API requires a username field; there is no second account
// here, so this is a fixed sentinel rather than the user's email (which would
// put a real identifier in the keychain's account slot for no benefit).
const SESSION_ACCOUNT = 'myexpense.session';

/**
 * ADR 0016 §5.1:
 * - AFTER_FIRST_UNLOCK (not WHEN_UNLOCKED) so a session survives a reboot
 *   without needing the device to be unlocked at the exact moment of a read.
 * - THIS_DEVICE_ONLY excludes the item from iCloud Keychain sync. A refresh
 *   token restored onto a second device would give two devices the same token
 *   family; the moment both refresh, the backend correctly sees a replay and
 *   revokes the family for both. Credentials here are device-bound by design.
 *
 * No `accessControl` (biometrics) — not requested, and it would put a Face ID
 * prompt in front of every cold start. This file is the only one that would
 * change if it is ever wanted (constitution §27).
 */
const OPTIONS = {
  service: SERVICE,
  accessible: Keychain.ACCESSIBLE.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

/**
 * @typedef {object} StoredSession
 * @property {string} accessToken
 * @property {string} refreshToken
 * @property {number} accessTokenExpiresAt Epoch ms.
 * @property {object} user The `UserResponse` from login (docs/api/authentication-api.md).
 */

/**
 * Writes the session as ONE atomic entry (ADR 0016 §5.1).
 *
 * Two entries would leave a window where the access token has been updated
 * and the refresh token has not if the process dies between writes — and a
 * stored refresh token that doesn't match its rotation state is exactly the
 * input that produces REFRESH_TOKEN_REUSE_DETECTED and a revoked family.
 *
 * @param {StoredSession} session
 * @returns {Promise<void>}
 */
export async function saveSession(session) {
  await Keychain.setGenericPassword(SESSION_ACCOUNT, JSON.stringify(session), OPTIONS);
}

/**
 * Reads the stored session.
 *
 * A corrupt/unparseable blob is treated as absent and wiped — there is
 * nothing honest to recover from a half-written credential (ADR 0016 §8.2).
 *
 * @returns {Promise<StoredSession | null>}
 */
export async function loadSession() {
  let credentials;
  try {
    credentials = await Keychain.getGenericPassword(OPTIONS);
  } catch (error) {
    // A keychain read can fail on a locked device or a corrupted keystore
    // entry. Never log the error object itself — it can echo the payload.
    if (__DEV__) {
      console.log('[auth] keychain read failed');
    }
    return null;
  }

  if (!credentials || !credentials.password) {
    return null;
  }

  try {
    const parsed = JSON.parse(credentials.password);
    if (!parsed || !parsed.accessToken || !parsed.refreshToken) {
      await clearSession();
      return null;
    }
    return parsed;
  } catch (error) {
    await clearSession();
    return null;
  }
}

/**
 * Wipes the stored session. Safe to call when nothing is stored.
 *
 * @returns {Promise<void>}
 */
export async function clearSession() {
  try {
    await Keychain.resetGenericPassword({ service: SERVICE });
  } catch (error) {
    if (__DEV__) {
      console.log('[auth] keychain clear failed');
    }
  }
}
