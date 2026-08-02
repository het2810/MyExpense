import { getIsOnline } from '../offline/connectivity';
import { getOps } from '../offline/outbox';
import { selectActiveOps } from '../offline/overlays/activeOps';
import { overlayBudget } from '../offline/overlays/budget';
import { useBudgetStore, BUDGET_GATE_TIMEOUT_MS } from './useBudgetStore';
import { useSyncStore } from './useSyncStore';

/**
 * The post-auth gate's data step —
 * docs/decisions/0027-offline-first-local-cache-and-replay-sync.md §8.4.
 *
 * `await hydrateAccount` -> start the engine -> resolve the active period:
 *
 * 1. Online: `loadActivePeriod()` with a 5 s timeout. Success -> server period.
 * 2. Offline, or step 1 failed with `status: 0`: the **cached** period with
 *    the budget overlay applied (a queued `PUT /budget/periods` counts).
 * 3. `404 NO_ACTIVE_PERIOD` -> `null` (Budget Settings), as today.
 * 4. No cache and the server unreachable (device offline, OR online with the
 *    backend down — NetInfo cannot tell those apart from a refused
 *    connection) -> `periodUnknown: true`; the navigator opens the Dashboard
 *    and the budget fills in on the next successful pull. Project Owner
 *    requirement 2026-11-11: a down server must never block the main page.
 * 5. The server answered with a real error (e.g. 500) -> unresolved; the
 *    splash keeps its Retry.
 *
 * `getPostAuthDestination` is unchanged — only the source of `activePeriod`
 * changes. Lives in the store layer because screens and navigators never
 * import `src/offline` (§8.1).
 */

/**
 * @param {string} userId
 * @returns {Promise<{ resolved: boolean, activePeriod: object | null, periodUnknown: boolean,
 *   errorMessage: string | null }>}
 */
export async function resolveGateActivePeriod(userId) {
  await useSyncStore.getState().startAccountSession(userId);

  if (getIsOnline()) {
    await useBudgetStore.getState().loadActivePeriod({ timeoutMs: BUDGET_GATE_TIMEOUT_MS });
  }
  // After the gate's own read, so the start-up pull cannot pre-empt it.
  // Idempotent: a Retry restarts the same engine for the same account.
  useSyncStore.getState().startEngine();

  const { hasLoaded, activePeriod, fetchStartedAt, loadError, isServerUnreachable } =
    useBudgetStore.getState();
  if (!hasLoaded) {
    // No cached period AND the server could not be reached — the device is
    // offline, or it is online but the backend is down (connection refused /
    // timeout; NetInfo still reports "online" then). Never block the app on
    // that: open the Dashboard with the period unknown. The budget store's
    // reconnect pull fills it in, and the mandatory Budget Settings gate is
    // only for a period the server has CONFIRMED does not exist.
    if (!getIsOnline() || isServerUnreachable) {
      return { resolved: true, activePeriod: null, periodUnknown: true, errorMessage: null };
    }
    // Reached the server and it failed (e.g. a 500): keep the splash Retry.
    return { resolved: false, activePeriod: null, periodUnknown: false, errorMessage: loadError };
  }

  const budgetOps = selectActiveOps(getOps(), 'budget', fetchStartedAt);
  return {
    resolved: true,
    activePeriod: overlayBudget(activePeriod, budgetOps),
    periodUnknown: false,
    errorMessage: null,
  };
}
