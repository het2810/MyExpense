import { isPeriodEnded } from '../utils/budgetPeriod';

/**
 * Pure function — no store reads, no navigation calls, no Date.now() side
 * effects beyond what dateDisplay.js's own getTodayIsoDate() already does
 * internally (the same "today is computed inside the date function, not
 * injected" convention every other date-comparison helper in this app
 * already follows).
 *
 * Three-valued per docs/decisions/0011-post-auth-budget-gate.md's second
 * same-day amendment, Part A — only the `isPeriodEnded` branch differs from
 * the ADR's original two-valued design (`'BudgetSettings'` -> `'BudgetSummary'`):
 * - `!activeBudgetPeriod` (brand-new account, nothing to summarize) stays
 *   `'BudgetSettings'`.
 * - `isPeriodEnded(...)` (the stored period is over) is now `'BudgetSummary'`
 *   — the user reviews the closed period's final numbers before proceeding
 *   to the next mandatory Budget Settings step.
 * - `!(amount > 0)` (defensive fallback for a somehow-invalid period —
 *   should not occur given Budget Settings' own `> 0` save validation)
 *   stays `'BudgetSettings'`, not `'BudgetSummary'` — a period that was
 *   never meaningfully funded has nothing honest to retrospect on either.
 * - Otherwise, `'Dashboard'`.
 *
 * @param {{ email: string } | { firstName: string, lastName: string, email: string } | null} user
 *   - useAuthStore().user. Not branched on today — this app has exactly one
 *     mock user and no per-account data isolation (docs/decisions/
 *     0010-budget-settings.md §4's clearPeriod note). Accepted as a
 *     parameter for API completeness / future multi-user support
 *     (constitution §27), not dead weight.
 * @param {object | null} activeBudgetPeriod - useBudgetStore().activePeriod
 *   (docs/decisions/0010-budget-settings.md §3/§4's shape).
 * @returns {'BudgetSummary' | 'BudgetSettings' | 'Dashboard'}
 */
export function getPostAuthDestination(user, activeBudgetPeriod) {
  if (!activeBudgetPeriod) {
    return 'BudgetSettings';
  }
  if (isPeriodEnded(activeBudgetPeriod)) {
    return 'BudgetSummary';
  }
  if (!(activeBudgetPeriod.amount > 0)) {
    return 'BudgetSettings';
  }
  return 'Dashboard';
}
