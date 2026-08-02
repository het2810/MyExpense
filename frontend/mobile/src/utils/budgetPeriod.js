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
 * **Reads `txnDate`, not `date`, as of Domain 4's wiring step** — the
 * transactions store now holds `TransactionResponse` verbatim
 * (docs/api/api-overview.md §4.1), with the API's own field names and nothing
 * renamed (constitution §15/§30). The formula itself is unchanged.
 *
 * **It sums the transactions it is GIVEN, which is now a loaded subset.**
 * `GET /transactions` is paginated (§4.1) and there is no aggregate endpoint
 * anywhere in §4/§5, so with more rows than are currently loaded this figure
 * is understated until the remaining pages have been read. That is recorded on
 * `useTransactionsStore` and flagged in Domain 4's wiring report rather than
 * hidden here; this function has no way to know and must not guess.
 *
 * @param {Array<{ type: string, txnDate: string, amount: number }>} transactions
 * @param {{ startDate: string, endDate: string } | null} period
 * @returns {number}
 */
export function computeSpentForPeriod(transactions, period) {
  if (!period) {
    return 0;
  }
  return transactions.reduce(
    (total, transaction) =>
      isSpendInPeriod(transaction, period) ? total + transaction.amount : total,
    0,
  );
}

/**
 * True when a transaction counts toward a period's spend — the single rule
 * every spend figure below shares with computeSpentForPeriod: an expense
 * (personal or group scope alike) dated inside the period.
 *
 * @param {object} transaction
 * @param {{ startDate: string, endDate: string }} period
 * @returns {boolean}
 */
function isSpendInPeriod(transaction, period) {
  return (
    transaction.type === 'expense' &&
    transaction.txnDate >= period.startDate &&
    transaction.txnDate <= period.endDate
  );
}

/**
 * The period's spend split by how it was paid: Cash, Online, or Split.
 * `cash + online + split` equals computeSpentForPeriod for the same inputs, so
 * the Dashboard's rows always add up to the "spent" figure above them.
 *
 * A split-originated row (`splitExpenseId` set — the caller's consumption
 * share, written by the server) counts as Split whatever its stored
 * `paymentMode`: the server has to store some value in that NOT NULL column,
 * and "cash" there means nothing to the user.
 *
 * A 'both' row contributes its stored portions; a 'both' row somehow missing
 * them (pre-migration data) falls back to 50/50 rather than throwing
 * (constitution §22). A row with no paymentMode counts as cash — the value Add
 * Expense sends when the Payment Mode setting is off.
 *
 * @param {object[]} transactions
 * @param {{ startDate: string, endDate: string } | null} period
 * @returns {{ cash: number, online: number, split: number }}
 */
export function computeSpentByPaymentModeForPeriod(transactions, period) {
  const totals = { cash: 0, online: 0, split: 0 };
  if (!period) {
    return totals;
  }
  transactions.forEach((transaction) => {
    if (!isSpendInPeriod(transaction, period)) {
      return;
    }
    if (transaction.splitExpenseId) {
      totals.split += transaction.amount;
    } else if (transaction.paymentMode === 'online') {
      totals.online += transaction.amount;
    } else if (transaction.paymentMode === 'both') {
      totals.cash += transaction.cashAmount ?? transaction.amount * 0.5;
      totals.online += transaction.onlineAmount ?? transaction.amount * 0.5;
    } else {
      totals.cash += transaction.amount;
    }
  });
  return totals;
}

/**
 * Spend against each live category cap of the period. A cap on a parent is
 * evaluated INCLUSIVE of its subcategories' spend (api-overview.md §5.2), so
 * `categories` (the top-level tree with `subcategories[]`) is needed to roll a
 * child-tagged transaction up to its capped parent. Caps whose category was
 * deleted (`categoryId: null`) are skipped — nothing can be tagged to them.
 *
 * @param {object[]} transactions
 * @param {{ startDate: string, endDate: string,
 *           categoryCaps: Array<{ categoryId: string | null, categoryName: string, monthlyCap: number }> } | null} period
 * @param {object[]} categories Top-level categories, each with `subcategories`.
 * @returns {Array<{ categoryId: string, categoryName: string, monthlyCap: number, spent: number }>}
 */
export function computeCategoryCapUsage(transactions, period, categories) {
  if (!period || !period.categoryCaps || period.categoryCaps.length === 0) {
    return [];
  }
  const parentIdByChildId = new Map();
  categories.forEach((category) => {
    (category.subcategories ?? []).forEach((child) => {
      parentIdByChildId.set(child.id, category.id);
    });
  });

  const spentByTopLevelId = new Map();
  transactions.forEach((transaction) => {
    if (!isSpendInPeriod(transaction, period) || !transaction.categoryId) {
      return;
    }
    const topLevelId = parentIdByChildId.get(transaction.categoryId) ?? transaction.categoryId;
    spentByTopLevelId.set(topLevelId, (spentByTopLevelId.get(topLevelId) ?? 0) + transaction.amount);
  });

  return period.categoryCaps
    .filter((cap) => cap.categoryId != null && cap.monthlyCap > 0)
    .map((cap) => ({
      categoryId: cap.categoryId,
      categoryName: cap.categoryName,
      monthlyCap: cap.monthlyCap,
      spent: spentByTopLevelId.get(cap.categoryId) ?? 0,
    }));
}
