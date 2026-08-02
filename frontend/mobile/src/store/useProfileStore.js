import { create } from 'zustand';
import * as usersApi from '../api/usersApi';
import { getErrorMessage, isSessionTerminalError } from '../api/errorMessages';
import { bindStorePersistence } from '../offline/persistence';
import { getSessionEpoch, registerSignOutReset } from './signOutReset';
import { CACHE_CONTRACT_STATE, keepsSnapshotOnFailure, nowIso } from './offlineStoreSupport';

/**
 * The caller's own profile — server-backed by `GET /api/v1/users/me` and
 * `PATCH /api/v1/users/me/premium` (docs/api/api-overview.md §2.1/§2.5) as of
 * Domain 2's wiring step (docs/roadmap/backend-build-order.md workflow step
 * 3). Previously `{ isPremiumUser, toggleIsPremiumUser }` — a purely local
 * mock tap-to-toggle (docs/decisions/0007-transaction-detail-screen.md §3.1).
 *
 * It holds the whole `UserProfileResponse` rather than a hand-picked field or
 * two, with no client-side reshaping or renaming (constitution §15/§30). Two
 * reasons: `isPremium` and the identity fields come from the same single
 * request, so splitting them into separate state would be two sources of
 * truth for one response; and `PATCH /users/me/premium` answers with the full
 * updated profile, which is then simply the new value of this field.
 *
 * Still a deliberately separate store from `useSettingsStore` — and the
 * distinction got sharper, not weaker, once both became server-backed. They
 * are different resources with different endpoints: `/users/me` is identity
 * and entitlement ("who am I, what tier am I"), `/users/me/settings` is
 * behavioural preference ("how should the app behave for me"). Merging them
 * would put two independent requests, two load states and two error states
 * behind one object.
 *
 * `isPremium` remains a boolean stub with no billing provider behind it
 * (api-overview.md §2.5) — what changed is that the flip is now persisted
 * server-side and survives a reinstall, where before it lived only in memory.
 *
 * ---
 * **HOW A FAILED PREMIUM TOGGLE BEHAVES: pending-until-confirmed**, the same
 * choice and the same reasoning as `useSettingsStore` (see that file's
 * comment). `isPremium` gates what Transaction Detail renders, so an
 * optimistic flip would unlock a premium surface the server just refused;
 * and because the PATCH answers with the authoritative profile, the confirmed
 * value is simply what the server returned. The banner is non-interactive
 * while the write is in flight, so a double tap cannot queue a second,
 * contradictory write.
 */

const INITIAL_STATE = {
  /** @type {object | null} The `UserProfileResponse`, verbatim. */
  profile: null,
  /** GET in flight. */
  isLoadingProfile: false,
  /** User-facing copy for a failed GET (constitution §22), or null. */
  profileError: null,
  /** PATCH /users/me/premium in flight. */
  isSavingPremium: false,
  /** User-facing copy for a failed premium PATCH, or null. */
  premiumError: null,
  /** True once `profile` holds a server (or cached) answer — ADR 0027 §8.8. */
  hasLoaded: false,
  ...CACHE_CONTRACT_STATE,
};

/**
 * Minimal shape check so a null/HTML/empty-200 response can never be written
 * into state as if it were a profile (`httpClient` resolves an empty body to
 * `null` — ADR 0016 §3.1). `isPremium` is checked explicitly because a
 * missing one would silently read as "not premium".
 *
 * @param {unknown} response
 * @returns {boolean}
 */
function isUserProfileResponse(response) {
  return (
    response != null && typeof response.id === 'string' && typeof response.isPremium === 'boolean'
  );
}

/**
 * True when the session changed while a request was in flight, meaning its
 * answer is about an account that is no longer signed in and must be
 * discarded rather than written into state (see signOutReset.js — the same
 * guard ADR 0016 §6.6 applies to a rotation that outlives its session).
 *
 * Returning without clearing the in-flight flag is deliberate and safe: the
 * sign-out reset has already restored INITIAL_STATE, flags included.
 *
 * @param {number} epochAtStart
 * @returns {boolean}
 */
function hasSessionChanged(epochAtStart) {
  return getSessionEpoch() !== epochAtStart;
}

export const useProfileStore = create((set, get) => ({
  ...INITIAL_STATE,

  /**
   * Reads `GET /users/me`. Cache-first: a second call is a no-op once the
   * profile is held, so re-entering a screen costs no request. Pass
   * `{ force: true }` for an explicit retry.
   *
   * Loaded lazily by `useCurrentUserProfile()` at the point of use — never
   * eagerly at app start. The signed-in user's name and email are already
   * available from the stored session (`useUserIdentity`), so nothing on the
   * startup path has to wait for this.
   *
   * @param {{ force?: boolean }} [options]
   * @returns {Promise<void>}
   */
  loadProfile: async ({ force = false } = {}) => {
    const state = get();
    if (state.isLoadingProfile) {
      return;
    }
    if (state.profile && !state.isFromCache && !force) {
      return;
    }

    const epochAtStart = getSessionEpoch();
    const fetchStartedAt = nowIso();
    set({ isLoadingProfile: true, profileError: null });

    try {
      const response = await usersApi.getCurrentUser();
      if (hasSessionChanged(epochAtStart)) {
        return;
      }
      if (!isUserProfileResponse(response)) {
        throw new Error('The profile response did not match the contract.');
      }
      set({
        profile: response,
        isLoadingProfile: false,
        profileError: null,
        hasLoaded: true,
        fetchStartedAt,
        isFromCache: false,
      });
    } catch (error) {
      if (hasSessionChanged(epochAtStart)) {
        return;
      }
      if (keepsSnapshotOnFailure(get(), error)) {
        set({ isLoadingProfile: false });
        return;
      }
      // `profile` stays null, so premium-gated surfaces stay locked and the
      // Profile screen offers a Retry. Identity still renders from the stored
      // session rather than going blank (see useUserIdentity). A terminal 401
      // shows nothing: the session is already gone and this store is about to
      // be reset.
      set({
        isLoadingProfile: false,
        profileError: isSessionTerminalError(error) ? null : getErrorMessage(error),
      });
    }
  },

  /**
   * `PATCH /users/me/premium` with an explicit target value — never a flip.
   * The endpoint requires `isPremium` and a missing value must never be read
   * as "switch premium off" (`backend/README.md` §11.6), so the intent is
   * stated rather than derived.
   *
   * @param {boolean} nextIsPremium
   * @returns {Promise<void>}
   */
  setPremium: async (nextIsPremium) => {
    const { isSavingPremium, profile } = get();
    if (isSavingPremium) {
      return;
    }
    // No write before a successful read: without the current value there is
    // nothing to toggle away from, and the UI keeps the banner inert until
    // the profile has loaded.
    if (!profile || profile.isPremium === nextIsPremium) {
      return;
    }

    const epochAtStart = getSessionEpoch();
    set({ isSavingPremium: true, premiumError: null });

    try {
      const response = await usersApi.updatePremium(nextIsPremium);
      if (hasSessionChanged(epochAtStart)) {
        return;
      }
      if (!isUserProfileResponse(response)) {
        throw new Error('The profile response did not match the contract.');
      }
      // The endpoint answers with the full updated profile, so the whole
      // object is replaced rather than one field patched locally.
      set({ profile: response, isSavingPremium: false, premiumError: null });
    } catch (error) {
      if (hasSessionChanged(epochAtStart)) {
        return;
      }
      // The banner is left showing the tier the server still holds — it was
      // never flipped locally.
      set({
        isSavingPremium: false,
        premiumError: isSessionTerminalError(error) ? null : getErrorMessage(error),
      });
    }
  },

  /**
   * Drops this account's profile — see signOutReset.js. There is deliberately
   * no separate "clear errors" action: each operation clears its own message
   * when it starts, and sign-out clears everything.
   */
  resetProfile: () => set({ ...INITIAL_STATE }),

  /**
   * ADR 0027 §8.8. Premium and profile edits stay online-only (§9); only the
   * read is cached.
   *
   * @param {{ profile: object }} data
   * @param {string | null} fetchStartedAt
   */
  hydrateFromCache: (data, fetchStartedAt) => {
    if (!isUserProfileResponse(data?.profile)) {
      return;
    }
    set({
      profile: data.profile,
      hasLoaded: true,
      isFromCache: true,
      fetchStartedAt,
      profileError: null,
    });
  },
}));

bindStorePersistence(useProfileStore, {
  storeKey: 'profile',
  watch: (state) => [state.profile],
  select: (state) => ({ profile: state.profile }),
  pull: () => useProfileStore.getState().loadProfile({ force: true }),
  pullOrder: 1,
});

registerSignOutReset(() => {
  useProfileStore.getState().resetProfile();
});
