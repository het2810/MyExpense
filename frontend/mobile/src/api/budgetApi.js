import { authorizedRequest } from './apiClient';
import { BUDGET_PATHS } from './config';

/**
 * Budget (Domain 5) — one thin function per wired endpoint, the shape
 * usersApi.js established (docs/decisions/0016-frontend-api-integration.md
 * §3.4). Contract: docs/api/api-overview.md §5.1–§5.2.
 *
 * Stateless: returns the parsed `BudgetPeriodResponse` and throws `ApiError`.
 * Layer rule (ADR 0016 §1): may import `apiClient` and `config` only.
 */

/**
 * `GET /api/v1/budget/active-period` -> `200 BudgetPeriodResponse`.
 *
 * `404 NO_ACTIVE_PERIOD` is a normal answer (the caller never saved a
 * period); the store, not this layer, turns it into `null`.
 *
 * `timeoutMs` (optional) lets the offline-aware post-auth gate cap its wait
 * (ADR 0027 §8.4); omitted, the transport default applies.
 *
 * @param {{ timeoutMs?: number }} [options]
 * @returns {Promise<object>}
 */
export function getActivePeriod({ timeoutMs } = {}) {
  return authorizedRequest(BUDGET_PATHS.activePeriod, timeoutMs ? { timeoutMs } : {});
}

/**
 * `PUT /api/v1/budget/periods` -> `201` (new) or `200` (edited in place).
 * `id` is sent only for an in-place edit; omitting it creates a new period.
 *
 * @param {{ id?: string, periodType: 'automatic' | 'custom', startDate: string,
 *           endDate: string, amount: number,
 *           categoryCaps: Array<{ categoryId: string, monthlyCap: number }> }} period
 * @returns {Promise<object>}
 */
export function upsertPeriod(period) {
  return authorizedRequest(BUDGET_PATHS.upsertPeriod, {
    method: 'PUT',
    body: period,
  });
}
