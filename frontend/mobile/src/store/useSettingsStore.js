import { create } from 'zustand';
import * as usersApi from '../api/usersApi';
import { getErrorMessage, isSessionTerminalError } from '../api/errorMessages';
import { bindStorePersistence } from '../offline/persistence';
import { buildSettingsUpdateOp } from '../offline/operations/settings';
import { getSessionEpoch, registerSignOutReset } from './signOutReset';
import { useAuthStore } from './useAuthStore';
import {
  CACHE_CONTRACT_STATE,
  OFFLINE_WRITES_ENABLED,
  enqueueWrite,
  keepsSnapshotOnFailure,
  nowIso,
  shouldFetch,
} from './offlineStoreSupport';

/**
 * Behavioural settings — server-backed by `GET`/`PATCH /api/v1/users/me/settings`
 * (docs/api/api-overview.md §2.3/§2.4) as of Domain 2's wiring step
 * (docs/roadmap/backend-build-order.md workflow step 3). Previously a
 * local-only pair of flips.
 *
 * Layering: stores may import `src/api/*`; screens may not (ADR 0016 §1).
 * Every call goes through `usersApi`, i.e. through
 * `apiClient.authorizedRequest`. The orchestration (guard -> request ->
 * state) lives here, never in a screen (constitution §8).
 *
 * ---
 * **HOW A FAILED TOGGLE BEHAVES: pending-until-confirmed, not optimistic.**
 *
 * A tap starts a PATCH and marks the field pending; the rendered value only
 * changes when the server answers, and what gets written is the
 * `UserSettingsResponse` **body** (which always carries both fields), never
 * the value the client asked for. A rejected change therefore never appears
 * to have been applied, and local state can never drift from the row in
 * `user_settings`.
 *
 * Why not optimistic-with-revert, which is the more usual choice for a
 * switch:
 *
 * 1. **These flags gate behaviour on other screens**, not just the look of a
 *    switch — `overspendingAlertsEnabled` drives Dashboard's overspend
 *    warnings, `paymentModeEnabled` adds/removes whole fields in Add Expense,
 *    and `subcategoriesEnabled` decides whether Category Picker offers a
 *    second level at all. Flipping optimistically means those screens render a
 *    configuration the server rejected. A switch that briefly shows the wrong position is a
 *    cosmetic lie; a form that offers fields the account doesn't have enabled
 *    is a functional one.
 * 2. **Rapid toggling is a real scenario** (the API rate limit is 120 req/min
 *    per user — `backend/README.md` §6). Refusing to start a second PATCH
 *    while one is in flight bounds this at one request per confirmed change,
 *    and removes out-of-order-response reconciliation entirely: with
 *    optimistic writes, two PATCHes answered out of order can leave state
 *    showing neither value the user chose.
 * 3. It is simply less machinery than a revert path plus a sequence number,
 *    and correctness comes before perceived speed (constitution §29).
 *
 * The visible cost, stated rather than hidden: on a slow connection the
 * switch lags behind the finger by the round trip, and while any PATCH is in
 * flight **all three** switches are disabled (`pendingField` is a single slot,
 * so two concurrent partial PATCHes can't race to write each other's field
 * back from a stale read — the documented trade-off, not a regression, ADR
 * 0019 §10.5). Locally that is tens of milliseconds; offline it fails
 * fast with a message and the switch stays where it was.
 */

// The documented server-side defaults (api-overview.md §2.3) — kept as the
// pre-load values so every existing consumer (Dashboard, Add Expense) behaves
// exactly as it did before this store was wired, rather than briefly reading
// `undefined`. They are a placeholder, not an answer: `hasLoaded` is what
// says the real values are known, and no PATCH is issued until it is true.
const DEFAULT_SETTINGS = {
  overspendingAlertsEnabled: true,
  paymentModeEnabled: false,
  // Opt-in, like `paymentModeEnabled` and for the same reason: a net-new
  // capability the user should consciously enable, not a default that would
  // change what every existing account's Category Picker offers without being
  // asked (docs/decisions/0019-subcategories-one-optional-level.md §6). The
  // server's column default is `false` too; this mirrors it.
  subcategoriesEnabled: false,
};

const INITIAL_STATE = {
  ...DEFAULT_SETTINGS,

  /** GET in flight. */
  isLoading: false,
  /** True once a GET has succeeded — i.e. the values above are the server's. */
  hasLoaded: false,
  /** User-facing copy for a failed GET (constitution §22), or null. */
  loadError: null,
  /** The field whose PATCH is in flight: a settings key, or null. */
  pendingField: null,
  /** User-facing copy for a failed PATCH, or null. */
  saveError: null,
  ...CACHE_CONTRACT_STATE,
};

/**
 * Guards against writing `undefined` into a boolean if a proxy, a captive
 * portal or a future contract change hands back something that isn't a
 * `UserSettingsResponse`. `httpClient` normalizes unparseable JSON, but an
 * empty 200 body resolves to `null` (ADR 0016 §3.1), which would otherwise
 * sail straight into state.
 *
 * @param {unknown} response
 * @returns {boolean}
 */
function isSettingsResponse(response) {
  return (
    response != null &&
    typeof response.overspendingAlertsEnabled === 'boolean' &&
    typeof response.paymentModeEnabled === 'boolean' &&
    // The third check is not optional tidiness (ADR 0019 §10.5): without it a
    // backend that has not shipped its half of this change would put
    // `undefined` into a boolean and silently disable the Subcategories row,
    // with no error anywhere. Failing the guard surfaces it instead.
    typeof response.subcategoriesEnabled === 'boolean'
  );
}

/**
 * True when the session changed while a request was in flight, meaning its
 * answer belongs to an account that is no longer signed in and must be
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

/**
 * Shared body of both setters — one PATCH carrying only the field that
 * changed (api-overview.md §2.4's partial update).
 *
 * @param {Function} set
 * @param {Function} get
 * @param {'overspendingAlertsEnabled' | 'paymentModeEnabled' | 'subcategoriesEnabled'} field
 * @param {boolean} nextValue
 * @returns {Promise<void>}
 */
async function patchSetting(set, get, field, nextValue) {
  const state = get();

  // One in-flight write at a time (see the module comment), and never a write
  // before a successful read: PATCHing a value derived from placeholder
  // defaults could overwrite a real server value the user never saw.
  if (state.pendingField || state.isLoading || !state.hasLoaded) {
    return;
  }
  if (state[field] === nextValue) {
    return;
  }

  const epochAtStart = getSessionEpoch();
  // OPTIMISTIC: move the displayed value NOW, before the request.
  //
  // ToggleSwitch wraps React Native's <Switch>, which is controlled. The
  // native thumb slides as soon as it is touched, but the very next render
  // still carried the OLD `value`, so the thumb slid back, and only the
  // server's response slid it forward again — the on > off > on flicker the
  // Project Owner reported on 2026-11-03. Writing the value up front means
  // the prop already agrees with where the thumb went, so there is one
  // transition instead of three. `previousValue` below restores it if the
  // write fails.
  const previousValue = state[field];

  if (OFFLINE_WRITES_ENABLED) {
    // ADR 0027 §8.8: queued under LWW. The value is applied locally at once
    // and stays applied — `settings.update`'s overlay effect is "patch the
    // values", which this already is. A superseded or failed op is corrected
    // by the next pull (the engine re-reads after every flush).
    set({ [field]: nextValue, saveError: null });
    const userId = useAuthStore.getState().user?.id;
    const result = await enqueueWrite(
      buildSettingsUpdateOp({ userId, changes: { [field]: nextValue } }),
    );
    if (!result.success) {
      set({ [field]: previousValue, saveError: result.error });
    }
    return;
  }

  set({ [field]: nextValue, pendingField: field, saveError: null });

  try {
    const response = await usersApi.updateUserSettings({ [field]: nextValue });
    if (hasSessionChanged(epochAtStart)) {
      return;
    }
    if (!isSettingsResponse(response)) {
      throw new Error('The settings response did not match the contract.');
    }
    set({
      overspendingAlertsEnabled: response.overspendingAlertsEnabled,
      paymentModeEnabled: response.paymentModeEnabled,
      subcategoriesEnabled: response.subcategoriesEnabled,
      pendingField: null,
      saveError: null,
    });
  } catch (error) {
    if (hasSessionChanged(epochAtStart)) {
      return;
    }
    // ROLL BACK the optimistic write above, so a failed save never leaves a
    // toggle showing a setting the server does not hold.
    // A non-ApiError (the throw above) maps to the generic copy; a stack trace
    // never reaches the user (constitution §22). A terminal 401 shows nothing:
    // the session is already gone and this store is about to be reset.
    set({
      [field]: previousValue,
      pendingField: null,
      saveError: isSessionTerminalError(error) ? null : getErrorMessage(error),
    });
  }
}

export const useSettingsStore = create((set, get) => ({
  ...INITIAL_STATE,

  /**
   * Reads the caller's settings. Cache-first: a second call is a no-op once a
   * read has succeeded, so re-entering a screen does not spend rate-limit
   * budget. Pass `{ force: true }` for an explicit retry.
   *
   * Loaded lazily by `useUserSettings()` at the point of use — never eagerly
   * at app start, which would put a network call in front of the splash gate
   * for data no visible screen needs yet.
   *
   * @param {{ force?: boolean }} [options]
   * @returns {Promise<void>}
   */
  loadSettings: async ({ force = false } = {}) => {
    const state = get();
    if (state.isLoading) {
      return;
    }
    if (!shouldFetch(state, force)) {
      return;
    }

    const epochAtStart = getSessionEpoch();
    const fetchStartedAt = nowIso();
    set({ isLoading: true, loadError: null });

    try {
      const response = await usersApi.getUserSettings();
      if (hasSessionChanged(epochAtStart)) {
        return;
      }
      if (!isSettingsResponse(response)) {
        throw new Error('The settings response did not match the contract.');
      }
      set({
        overspendingAlertsEnabled: response.overspendingAlertsEnabled,
        paymentModeEnabled: response.paymentModeEnabled,
        subcategoriesEnabled: response.subcategoriesEnabled,
        isLoading: false,
        hasLoaded: true,
        loadError: null,
        fetchStartedAt,
        isFromCache: false,
      });
    } catch (error) {
      if (hasSessionChanged(epochAtStart)) {
        return;
      }
      if (keepsSnapshotOnFailure(get(), error)) {
        set({ isLoading: false });
        return;
      }
      // `hasLoaded` stays false, so the toggles stay disabled and the screen
      // offers a Retry rather than letting the user "set" a value whose
      // current state was never learned.
      set({
        isLoading: false,
        loadError: isSessionTerminalError(error) ? null : getErrorMessage(error),
      });
    }
  },

  /**
   * @param {boolean} nextValue
   * @returns {Promise<void>}
   */
  setOverspendingAlertsEnabled: (nextValue) =>
    patchSetting(set, get, 'overspendingAlertsEnabled', nextValue),

  /**
   * Opt-in cash-vs-online spend tracking (docs/decisions/0003-payment-mode-and-date-tracking.md
   * §1). Still defaults to off, unlike Overspending Alerts — that default now
   * lives server-side (api-overview.md §2.3), mirrored above only as the
   * pre-load placeholder.
   *
   * @param {boolean} nextValue
   * @returns {Promise<void>}
   */
  setPaymentModeEnabled: (nextValue) => patchSetting(set, get, 'paymentModeEnabled', nextValue),

  /**
   * Opt-in one-level subcategories (docs/decisions/0019-subcategories-one-optional-level.md
   * §6). A **UI affordance only** — it gates nothing server-side:
   * `GET /categories` always returns the complete tree and
   * `POST /categories` accepts a `parentCategoryId` whichever way this is set,
   * exactly as `paymentModeEnabled` has never gated a transaction write.
   *
   * **Turning it off hides; it never destroys** (§6.2). This writes one
   * boolean and touches nothing else: no subcategory is deleted, reparented or
   * flagged, nothing tagged to one is re-tagged, and turning it back on
   * restores the full experience with nothing to re-create. Rendering a
   * transaction's category path does **not** consult it either — a history row
   * that read differently depending on a mutable preference would be unstable
   * history.
   *
   * @param {boolean} nextValue
   * @returns {Promise<void>}
   */
  setSubcategoriesEnabled: (nextValue) =>
    patchSetting(set, get, 'subcategoriesEnabled', nextValue),

  /**
   * Drops this account's settings — see signOutReset.js. There is
   * deliberately no separate "clear errors" action: each operation clears its
   * own message when it starts, and sign-out clears everything.
   */
  resetSettings: () => set({ ...INITIAL_STATE }),

  /**
   * ADR 0027 §8.8 — cached toggles render at once; the next load re-reads.
   *
   * @param {object} data A `UserSettingsResponse`-shaped object.
   * @param {string | null} fetchStartedAt
   */
  hydrateFromCache: (data, fetchStartedAt) => {
    if (!isSettingsResponse(data)) {
      return;
    }
    set({
      overspendingAlertsEnabled: data.overspendingAlertsEnabled,
      paymentModeEnabled: data.paymentModeEnabled,
      subcategoriesEnabled: data.subcategoriesEnabled,
      hasLoaded: true,
      isFromCache: true,
      fetchStartedAt,
      loadError: null,
    });
  },
}));

bindStorePersistence(useSettingsStore, {
  storeKey: 'settings',
  watch: (state) => [
    state.overspendingAlertsEnabled,
    state.paymentModeEnabled,
    state.subcategoriesEnabled,
  ],
  select: (state) => ({
    overspendingAlertsEnabled: state.overspendingAlertsEnabled,
    paymentModeEnabled: state.paymentModeEnabled,
    subcategoriesEnabled: state.subcategoriesEnabled,
  }),
  pull: () => useSettingsStore.getState().loadSettings({ force: true }),
  pullOrder: 2,
});

registerSignOutReset(() => {
  useSettingsStore.getState().resetSettings();
});
