import { create } from 'zustand';
import * as budgetApi from '../api/budgetApi';
import { TRANSPORT_STATUS } from '../api/apiError';
import { getErrorMessage, isSessionTerminalError } from '../api/errorMessages';
import { bindStorePersistence } from '../offline/persistence';
import { buildBudgetSaveOp } from '../offline/operations/budget';
import { GATE_ONLINE_TIMEOUT_MS } from '../offline/config';
import { getSessionEpoch, registerSignOutReset } from './signOutReset';
import {
  CACHE_CONTRACT_STATE,
  OFFLINE_WRITES_ENABLED,
  enqueueWrite,
  keepsSnapshotOnFailure,
  nowIso,
} from './offlineStoreSupport';

/**
 * Zustand store holding the caller's active budget period — server-backed
 * since Domain 5's wiring (docs/api/api-overview.md §5). Before this the
 * period lived in memory only, so every reload / sign-in found `null` and the
 * post-auth gate (docs/decisions/0011-post-auth-budget-gate.md) sent the user
 * to Budget Settings even though a period had been saved.
 *
 * activePeriod shape (ADR 0010 §3, matching `BudgetPeriodResponse`):
 * {
 *   id: string,
 *   periodType: 'automatic' | 'custom',
 *   startDate: string,          // YYYY-MM-DD
 *   endDate: string,            // YYYY-MM-DD
 *   amount: number,
 *   categoryCaps: [{ categoryId: string | null, categoryName: string, monthlyCap: number }],
 * }
 * `categoryId` is `null` when the capped category was deleted (§5.1).
 */

const NO_ACTIVE_PERIOD = 'NO_ACTIVE_PERIOD';

/**
 * True when the account changed while a request was in flight — its answer
 * belongs to the previous session and must be dropped (signOutReset.js).
 *
 * @param {number} epochAtStart
 * @returns {boolean}
 */
function hasSessionChanged(epochAtStart) {
  return getSessionEpoch() !== epochAtStart;
}

const INITIAL_STATE = {
  activePeriod: null,
  hasLoaded: false,
  isLoading: false,
  loadError: null,
  /**
   * True when the last read never reached the server (offline, connection
   * refused, timeout). The post-auth gate treats that as "server unreachable"
   * and opens the Dashboard rather than blocking on the splash.
   */
  isServerUnreachable: false,
  isSaving: false,
  ...CACHE_CONTRACT_STATE,
};

/**
 * Amounts are `BigDecimal` server-side; coerced once here so every consumer
 * does plain arithmetic.
 *
 * @param {object} response A `BudgetPeriodResponse`.
 * @returns {object}
 */
function normalizePeriod(response) {
  return {
    id: response.id,
    periodType: response.periodType,
    startDate: response.startDate,
    endDate: response.endDate,
    amount: Number(response.amount),
    categoryCaps: (response.categoryCaps ?? []).map((cap) => ({
      categoryId: cap.categoryId ?? null,
      categoryName: cap.categoryName,
      monthlyCap: Number(cap.monthlyCap),
    })),
  };
}

export const useBudgetStore = create((set, get) => ({
  ...INITIAL_STATE,

  /**
   * Reads `GET /budget/active-period`. `404 NO_ACTIVE_PERIOD` is a successful
   * "never saved one" answer and leaves `activePeriod` null with
   * `hasLoaded: true`. Any other failure leaves `hasLoaded: false` and sets
   * `loadError`, so the gate can offer a retry instead of wrongly routing to
   * Budget Settings.
   *
   * Offline (ADR 0027 §8.4/§8.8): a `status: 0` failure while a cached period
   * is held keeps it and sets no error, so the post-auth gate can route from
   * the cache instead of showing the splash Retry. `timeoutMs` lets the gate
   * cap its wait at 5 s; a timeout is also `status: 0`.
   *
   * @param {{ timeoutMs?: number }} [options]
   * @returns {Promise<void>}
   */
  loadActivePeriod: async ({ timeoutMs } = {}) => {
    if (get().isLoading) {
      return;
    }
    const epochAtStart = getSessionEpoch();
    const fetchStartedAt = nowIso();
    set({ isLoading: true, loadError: null, isServerUnreachable: false });

    try {
      const response = await budgetApi.getActivePeriod({ timeoutMs });
      if (hasSessionChanged(epochAtStart)) {
        return;
      }
      set({
        activePeriod: normalizePeriod(response),
        hasLoaded: true,
        isLoading: false,
        fetchStartedAt,
        isFromCache: false,
      });
    } catch (error) {
      if (hasSessionChanged(epochAtStart)) {
        return;
      }
      if (error?.status === 404 && error?.code === NO_ACTIVE_PERIOD) {
        set({
          activePeriod: null,
          hasLoaded: true,
          isLoading: false,
          fetchStartedAt,
          isFromCache: false,
        });
        return;
      }
      const isServerUnreachable = error?.status === TRANSPORT_STATUS;
      if (keepsSnapshotOnFailure(get(), error)) {
        set({ isLoading: false, isServerUnreachable });
        return;
      }
      set({
        isLoading: false,
        isServerUnreachable,
        loadError: isSessionTerminalError(error) ? null : getErrorMessage(error),
      });
    }
  },

  /**
   * `PUT /budget/periods`. Pass `id` to edit the current period in place;
   * omit it to create the next one (ADR 0010 §5). The server's response, not
   * the request, becomes `activePeriod`.
   *
   * @param {{ id?: string | null, periodType: string, startDate: string,
   *           endDate: string, amount: number,
   *           categoryCaps: Array<{ categoryId: string, monthlyCap: number }> }} values
   * @returns {Promise<{ success: boolean, error: string | null }>}
   */
  savePeriod: async (values) => {
    if (get().isSaving) {
      return { success: false, error: null };
    }

    if (OFFLINE_WRITES_ENABLED) {
      // ADR 0027 §3.4: the id is always sent — the current period's to edit
      // in place, a new client id to create.
      const op = buildBudgetSaveOp(values);
      const result = await enqueueWrite(op);
      return { ...result, id: op.entityId, pending: true };
    }

    const epochAtStart = getSessionEpoch();
    set({ isSaving: true });

    const body = {
      periodType: values.periodType,
      startDate: values.startDate,
      endDate: values.endDate,
      amount: values.amount,
      categoryCaps: values.categoryCaps,
    };
    if (values.id) {
      body.id = values.id;
    }

    try {
      const response = await budgetApi.upsertPeriod(body);
      if (hasSessionChanged(epochAtStart)) {
        return { success: false, error: null };
      }
      set({ activePeriod: normalizePeriod(response), hasLoaded: true, isSaving: false });
      return { success: true, error: null };
    } catch (error) {
      if (hasSessionChanged(epochAtStart)) {
        return { success: false, error: null };
      }
      set({ isSaving: false });
      return {
        success: false,
        error: isSessionTerminalError(error) ? null : getErrorMessage(error),
      };
    }
  },

  /**
   * Local-only discard of the held period — Sign Up's defensive reset
   * (ADR 0011 §6). The server never had a period for a brand-new account.
   */
  clearPeriod: () => set({ activePeriod: null }),

  /**
   * ADR 0027 §8.4/§8.8 — the cached period (or the cached "none saved") is
   * what the post-auth gate routes from when offline.
   *
   * @param {{ activePeriod: object | null }} data
   * @param {string | null} fetchStartedAt
   */
  hydrateFromCache: (data, fetchStartedAt) => {
    if (!data || !('activePeriod' in data)) {
      return;
    }
    set({
      activePeriod: data.activePeriod ? normalizePeriod(data.activePeriod) : null,
      hasLoaded: true,
      isFromCache: true,
      fetchStartedAt,
      loadError: null,
    });
  },

  resetBudget: () => set({ ...INITIAL_STATE }),
}));

registerSignOutReset(() => {
  useBudgetStore.getState().resetBudget();
});

/** The gate's network wait (ADR 0027 §8.4). Re-exported so the navigator reads one number. */
export const BUDGET_GATE_TIMEOUT_MS = GATE_ONLINE_TIMEOUT_MS;

bindStorePersistence(useBudgetStore, {
  storeKey: 'budget',
  watch: (state) => [state.activePeriod],
  select: (state) => ({ activePeriod: state.activePeriod }),
  pull: () => useBudgetStore.getState().loadActivePeriod(),
  pullOrder: 4,
});
