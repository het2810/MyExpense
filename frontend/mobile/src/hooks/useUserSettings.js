import { useCallback, useEffect } from 'react';
import { useSettingsStore } from '../store/useSettingsStore';

/**
 * Behavioural settings (`GET`/`PATCH /api/v1/users/me/settings` —
 * docs/api/api-overview.md §2.3/§2.4), loaded on first use rather than at app
 * start.
 *
 * **This hook is the load trigger**, the same arrangement as
 * `useCurrentUserProfile`: the Profile screen owns these rows, so it is where
 * the read happens. The loader is cache-first and single-flight, so one
 * request per session unless an explicit `reload()` asks for another.
 *
 * Read-only consumers keep reading `useSettingsStore` directly and do not use
 * this hook — Dashboard's overspend warnings and Add Expense's payment-mode
 * fields. They therefore render the documented defaults (alerts on, payment
 * mode off) until something loads the real values, which today means until
 * the Profile screen is opened in this session. Making them load too is a
 * one-line change per screen (swap the two selectors for this hook); it was
 * left out deliberately rather than overlooked, because Dashboard is the
 * post-auth landing surface and a fetch there is close to fetching at
 * startup. Flagged to the Project Owner.
 *
 * **One screen group has since opted in, deliberately:** the category
 * surfaces, through `useCategories()`. `subcategoriesEnabled` decides what
 * Category Picker *offers*, so rendering the pre-load default would hide a
 * user's own subcategories until they happened to visit Profile — a wrong
 * answer rather than a stale one. See that hook's note.
 *
 * @returns {{
 *   overspendingAlertsEnabled: boolean,
 *   paymentModeEnabled: boolean,
 *   subcategoriesEnabled: boolean,
 *   hasLoaded: boolean,
 *   isBusy: boolean,
 *   isSavingSubcategories: boolean,
 *   loadError: string | null,
 *   saveError: string | null,
 *   setOverspendingAlertsEnabled: (next: boolean) => Promise<void>,
 *   setPaymentModeEnabled: (next: boolean) => Promise<void>,
 *   setSubcategoriesEnabled: (next: boolean) => Promise<void>,
 *   reload: () => void,
 * }}
 */
export function useUserSettings() {
  const overspendingAlertsEnabled = useSettingsStore((state) => state.overspendingAlertsEnabled);
  const paymentModeEnabled = useSettingsStore((state) => state.paymentModeEnabled);
  const subcategoriesEnabled = useSettingsStore((state) => state.subcategoriesEnabled);
  const isLoading = useSettingsStore((state) => state.isLoading);
  const hasLoaded = useSettingsStore((state) => state.hasLoaded);
  const loadError = useSettingsStore((state) => state.loadError);
  const pendingField = useSettingsStore((state) => state.pendingField);
  const saveError = useSettingsStore((state) => state.saveError);
  const loadSettings = useSettingsStore((state) => state.loadSettings);
  const setOverspendingAlertsEnabled = useSettingsStore(
    (state) => state.setOverspendingAlertsEnabled,
  );
  const setPaymentModeEnabled = useSettingsStore((state) => state.setPaymentModeEnabled);
  const setSubcategoriesEnabled = useSettingsStore((state) => state.setSubcategoriesEnabled);

  useEffect(() => {
    // A no-op once a read has succeeded; after a failure `hasLoaded` is still
    // false, so re-entering the screen retries.
    loadSettings();
  }, [loadSettings]);

  const reload = useCallback(() => {
    loadSettings({ force: true });
  }, [loadSettings]);

  return {
    overspendingAlertsEnabled,
    paymentModeEnabled,
    subcategoriesEnabled,
    hasLoaded,
    // One flag rather than three: every switch is disabled together while any
    // write is in flight (useSettingsStore explains why), so the caller never
    // needs to know *which* field is pending.
    isBusy: isLoading || pendingField !== null,
    // The one exception, and only because one screen genuinely needs it:
    // ManageCategoriesScreen renders the Subcategories switch *and* the list
    // that switch reshapes. Because writes are pending-until-confirmed, a tap
    // moves nothing on screen until the server answers, so that screen says
    // "Saving…" in the meantime — and it must only say so for this field, not
    // for an unrelated reload or another field's write. Exposed as a named
    // boolean rather than leaking `pendingField`'s key strings into a screen;
    // Profile still needs nothing more than the collective `isBusy`.
    isSavingSubcategories: pendingField === 'subcategoriesEnabled',
    loadError,
    saveError,
    setOverspendingAlertsEnabled,
    setPaymentModeEnabled,
    setSubcategoriesEnabled,
    reload,
  };
}
