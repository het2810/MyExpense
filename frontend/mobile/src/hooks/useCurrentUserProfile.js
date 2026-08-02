import { useCallback, useEffect } from 'react';
import { useProfileStore } from '../store/useProfileStore';

/**
 * The caller's profile (`GET /api/v1/users/me` — docs/api/api-overview.md
 * §2.1), loaded on first use rather than at app start.
 *
 * **This hook is the load trigger.** A screen that needs a profile fact uses
 * it and the request happens; a screen that doesn't, doesn't. That is what
 * keeps the fetch out of the startup path (nothing on the splash/restore path
 * calls it) while still never showing a premium-gated surface based on a
 * guess. The underlying loader is cache-first and single-flight, so mounting
 * several consumers, or re-entering a screen, costs one request per session —
 * which matters against a 120 req/min per-user limit (`backend/README.md`
 * §6).
 *
 * Call sites today: ProfileScreen (identity, premium banner) and
 * TransactionDetailScreen (the premium Payment Method card).
 *
 * Business logic stays out of the components (constitution §8): the screens
 * get values and callbacks, never a request.
 *
 * @returns {{
 *   profile: object | null,
 *   isPremium: boolean,
 *   hasLoaded: boolean,
 *   isLoading: boolean,
 *   loadError: string | null,
 *   isSavingPremium: boolean,
 *   premiumError: string | null,
 *   setPremium: (nextIsPremium: boolean) => Promise<void>,
 *   reload: () => void,
 * }}
 */
export function useCurrentUserProfile() {
  const profile = useProfileStore((state) => state.profile);
  const isLoading = useProfileStore((state) => state.isLoadingProfile);
  const loadError = useProfileStore((state) => state.profileError);
  const isSavingPremium = useProfileStore((state) => state.isSavingPremium);
  const premiumError = useProfileStore((state) => state.premiumError);
  const loadProfile = useProfileStore((state) => state.loadProfile);
  const setPremium = useProfileStore((state) => state.setPremium);

  useEffect(() => {
    // A no-op when the profile is already held. When a previous attempt
    // failed, `profile` is still null — so simply re-entering the screen
    // retries, which is the cheapest recovery path there is.
    loadProfile();
  }, [loadProfile]);

  const reload = useCallback(() => {
    loadProfile({ force: true });
  }, [loadProfile]);

  return {
    profile,
    // Not premium until the server says so. A locked premium surface while
    // the profile is loading or unreachable is the safe direction to fail.
    isPremium: profile ? profile.isPremium : false,
    hasLoaded: profile !== null,
    isLoading,
    loadError,
    isSavingPremium,
    premiumError,
    setPremium,
    reload,
  };
}
