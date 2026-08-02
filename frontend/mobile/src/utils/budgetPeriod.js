/**
 * Budget-period business logic — docs/decisions/0010-budget-settings.md §2/
 * §5. Kept separate from dateDisplay.js, which is scoped to transaction
 * date/time *display* formatting per its own docstring; this file is
 * budget-period-specific business logic, matching the precedent
 * splitCalculations.js/activityLogEntries.js already set of giving each
 * feature domain its own utility file.
 */

import { getTodayIsoDate, toIsoDateString, parseIsoDate } from './dateDisplay';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * The "Automatic" period definition, exact per ADR 0010 §2: a rolling
 * calendar month — startDate is the 1st of the current calendar month,
 * endDate is the last day of the current calendar month, both computed from
 * *today* at the moment the period is saved.
 * @returns {{ startDate: string, endDate: string }} both YYYY-MM-DD
 */
export function getCurrentMonthRange() {
  const now = new Date();
  const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  // Day 0 of the following month is the last day of the current month.
  const lastDayOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);

  return {
    startDate: toIsoDateString(firstDayOfMonth),
    endDate: toIsoDateString(lastDayOfMonth),
  };
}

/**
 * The single shared "is this period over" comparison — reused by
 * getPostAuthDestination (docs/decisions/0011-post-auth-budget-gate.md),
 * Budget Settings' own save-time validation (ADR 0010 §5), and the
 * mid-session re-check hooked at Profile's "Budget Settings" row (ADR
 * 0011's second same-day amendment, Part D) — never three independently
 * authored copies of the same `endDate < today` comparison.
 *
 * ISO `YYYY-MM-DD` strings compare correctly with plain string comparison
 * (zero-padded, most-significant component first), so no Date parsing is
 * needed here.
 *
 * @param {{ endDate: string } | null} period
 * @returns {boolean} false when period is null/undefined — nothing to have
 *   "ended" if no period exists at all.
 */
export function isPeriodEnded(period) {
  if (!period) {
    return false;
  }
  return period.endDate < getTodayIsoDate();
}

/**
 * `dailyAverage`'s denominator — docs/decisions/0010-budget-settings.md
 * §8.4, exact formula:
 *
 *   daysElapsedInPeriod = max(1, wholeCalendarDaysBetween(startDate,
 *                              min(today, endDate)) + 1)
 *
 * `+ 1` makes the range inclusive of both the start day and today (or the
 * period's end, whichever is earlier) — day one of a period should compute
 * against `1` day elapsed, not `0`. `max(1, ...)` is a defensive floor
 * against a same-day period start producing a zero denominator.
 *
 * @param {{ startDate: string, endDate: string }} period
 * @returns {number}
 */
export function getDaysElapsedInPeriod(period) {
  const todayIso = getTodayIsoDate();
  // min(today, endDate) — plain string comparison is correct here since
  // both are zero-padded YYYY-MM-DD strings, sorting identically to their
  // chronological order.
  const effectiveEndIso = period.endDate < todayIso ? period.endDate : todayIso;

  const startMs = parseIsoDate(period.startDate).getTime();
  const endMs = parseIsoDate(effectiveEndIso).getTime();
  const wholeCalendarDaysBetween = Math.round((endMs - startMs) / MS_PER_DAY);

  return Math.max(1, wholeCalendarDaysBetween + 1);
}

/**
 * `spent` — docs/decisions/0010-budget-settings.md §8.2's exact formula:
 * sum of expense transactions whose `date` falls within
 * `[period.startDate, period.endDate]`. No scope/viewMode filtering — sums
 * every expense transaction (personal and group) within the range, per the
 * ADR's explicit "the summary card is intentionally NOT scoped by
 * viewMode" convention.
 *
 * Shared between DashboardScreen (a live figure, recomputed on every
 * render) and BudgetSummaryScreen (the same formula, evaluated once over a
 * closed, now-past period — ADR 0010's second same-day amendment, Part B)
 * so both read one implementation of the correctness-critical `spent`
 * calculation, never two independently-authored copies.
 *
 * @param {Array<{ type: string, date: string, amount: number }>} transactions
 * @param {{ startDate: string, endDate: string } | null} period
 * @returns {number}
 */
export function computeSpentForPeriod(transactions, period) {
  if (!period) {
    return 0;
  }
  return transactions.reduce((total, transaction) => {
    if (
      transaction.type === 'expense' &&
      transaction.date >= period.startDate &&
      transaction.date <= period.endDate
    ) {
      return total + transaction.amount;
    }
    return total;
  }, 0);
}
