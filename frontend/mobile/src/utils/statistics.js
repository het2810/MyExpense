/**
 * Statistics business logic — the derivations `GET /statistics/categories`
 * (docs/api/api-overview.md §14.1) deliberately does **not** ship, kept in one
 * place so no screen re-implements them (constitution §8, and
 * docs/decisions/0022-statistics-expenses-by-parent-category.md's Frontend
 * Engineer follow-up 2: "keep the rounding/sum-to-100% treatment in ONE place
 * rather than per screen").
 *
 * Its own file, matching the precedent budgetPeriod.js/splitCalculations.js/
 * activityLogEntries.js already set of giving each feature domain one utility
 * module rather than growing a shared grab-bag.
 *
 * Pure functions only: no React, no store, no api/ import. They are given the
 * response's numbers and hand back display-ready ones.
 *
 * ---
 * **WHAT §14 OMITS, AND WHY EACH OMISSION LANDS HERE**
 *
 * - **No `percentage` field.** A share is `amount / totalSpent`, two numbers
 *   the payload already carries, and `totalSpent` is guaranteed to be exactly
 *   the sum of `categories[].amount` so the division is well-defined (ADR 0022
 *   §4). Rounding it is a presentation decision the contract has no business
 *   freezing — so it is decided once, here, by `formatSharePercent`.
 * - **No "direct spend" field on a parent.** It is `amount` minus the sum of
 *   `subcategories[].amount` (§14.1), one subtraction in the one place that
 *   wants it — `computeDirectSpend`.
 * - **No range default.** The contract takes any range and has no
 *   `budgetPeriodId` (ADR 0022 §2); which range the tab opens on — and, since
 *   2026-11-01, which other ranges it can step to — is a product decision, made
 *   once by `resolveStatisticsRange`.
 */

import { toPaise } from './currency';
import { getCurrentMonthRange } from './budgetPeriod';
import { getExactDateLabel, getMonthYearLabel, parseIsoDate, toIsoDateString } from './dateDisplay';

/**
 * The inclusive bounds of the calendar month `monthsBack` months before the
 * current one — `0` is this month, `1` is last month, and so on.
 *
 * **Anchored on `getCurrentMonthRange()` rather than on `new Date()`**, so
 * "which month is the current one" has exactly one definition in this app (ADR
 * 0010 §2's, which the Dashboard and Budget Settings already read). This only
 * steps backwards from it.
 *
 * Only the last-day idiom is restated: day 0 of the following month is the last
 * day of the month before it, which also makes February and a 30-day month
 * correct without a lookup table.
 *
 * @param {number} monthsBack Whole months, `0` or more.
 * @returns {{ startDate: string, endDate: string }} Both `YYYY-MM-DD`.
 */
function getMonthRangeBefore(monthsBack) {
  const thisMonthStart = parseIsoDate(getCurrentMonthRange().startDate);
  const year = thisMonthStart.getFullYear();
  const month = thisMonthStart.getMonth() - monthsBack;

  return {
    startDate: toIsoDateString(new Date(year, month, 1)),
    endDate: toIsoDateString(new Date(year, month + 1, 0)),
  };
}

/**
 * The range the Statistics tab reads, and the single place that decision is
 * made.
 *
 * **The active budget period when one exists, the current calendar month when
 * it does not** — ADR 0022 §2's own recommendation, and the alignment the
 * app's budgeting model implies: §14 takes no `budgetPeriodId`, so the tab
 * aligns with the user's period *by choosing its dates*, never by a
 * server-side join. The fallback matters rather than being theoretical: the
 * post-auth budget gate (docs/decisions/0011-post-auth-budget-gate.md) means a
 * user with no saved period exists, and statistics must still answer for them.
 *
 * `periodType` is irrelevant here — an `automatic` period's dates are already
 * the current calendar month (`getCurrentMonthRange`, ADR 0010 §2), so both
 * branches agree for that case and only a `custom` period diverges.
 *
 * An **ended** period's dates are still used while it is the stored one: the
 * tab describes the period the user last set, and the post-auth gate is what
 * replaces it. Nothing here second-guesses that.
 *
 * `source` is returned rather than re-derived by the caller so the screen's
 * label and the range itself can never disagree.
 *
 * ---
 * **`monthsBack` IS THE RANGE PICKER** (Project Owner, 2026-11-01 — "in the
 * stats tab I can't view the previous months transaction donut"). `0` keeps the
 * two branches above byte-for-byte, so the tab still *opens* on the period it
 * always did; any value above `0` leaves the budget period behind and answers
 * with a plain calendar month, because a budget period is a single stored span
 * and there is no "previous budget period" anywhere in this app to step to
 * (`useBudgetStore` holds one `activePeriod`; ADR 0010 keeps no history, and
 * §14 takes no `budgetPeriodId` to ask the server for one either).
 *
 * That is why a past month gets its own `source` rather than reusing
 * `'calendar-month'`: 'This month' is a true caption for exactly one of them.
 *
 * Consequence worth stating, because it is visible with a **custom** period: at
 * `monthsBack: 1` the user sees last calendar month, which may overlap the
 * period shown at `0`. Each is labelled for what it is, nothing is double
 * counted inside a single range, and stepping forward returns to the period —
 * so the overlap is legible rather than wrong. Aligning the steps to period
 * boundaries would need period history the app does not store; flagged in the
 * handoff rather than faked.
 *
 * **Nothing here caps `monthsBack`.** Stepping into a month with no expenses is
 * a successful `200` with an empty array (§14.1) and gets the screen's genuine
 * empty state, which is an accurate statement. Stepping *forward* past the
 * current month is what is forbidden, and the caller owns that bound —
 * `useCategoryStatistics` never lets this argument go below `0`.
 *
 * @param {{ startDate?: string, endDate?: string } | null} activePeriod
 *   `useBudgetStore`'s `activePeriod` (still local this phase — Domain 5 is
 *   unbuilt, so `GET /budget/active-period` is not wired).
 * @param {number} [monthsBack] Whole calendar months before the current one.
 *   `0` (the default) is the tab's original range and keeps every existing
 *   single-argument caller unchanged.
 * @returns {{ dateFrom: string, dateTo: string,
 *   source: 'budget-period' | 'calendar-month' | 'past-month' }} Both dates
 *   `YYYY-MM-DD`, inclusive, as §14.1 expects.
 */
export function resolveStatisticsRange(activePeriod, monthsBack = 0) {
  if (monthsBack > 0) {
    const pastMonth = getMonthRangeBefore(monthsBack);
    return { dateFrom: pastMonth.startDate, dateTo: pastMonth.endDate, source: 'past-month' };
  }

  if (activePeriod && activePeriod.startDate && activePeriod.endDate) {
    return {
      dateFrom: activePeriod.startDate,
      dateTo: activePeriod.endDate,
      source: 'budget-period',
    };
  }

  const { startDate, endDate } = getCurrentMonthRange();
  return { dateFrom: startDate, dateTo: endDate, source: 'calendar-month' };
}

/**
 * One category's share of the range's total spend, `0..1`.
 *
 * **The zero-total guard is the point of this function.** §14 answers `200`
 * with `totalSpent: 0.00` for a range with no expenses (ADR 0022 §5), so the
 * denominator is genuinely zero in a perfectly normal case — not an error
 * case. Dividing would produce `NaN` (or `Infinity`), which renders as a blank
 * percentage and a bar of `NaN%` width. It returns `0` instead, and the screen
 * shows its empty state rather than any bars at all.
 *
 * Non-finite inputs return `0` for the same reason: a malformed number must
 * reach a width, not a layout engine.
 *
 * Clamped to `1`: the contract guarantees `totalSpent` is the sum of the
 * amounts, so a share above 1 is impossible — but a bar wider than its track
 * is not a failure worth rendering if the server ever disagrees with itself.
 *
 * @param {number} amount
 * @param {number} totalSpent
 * @returns {number} 0..1
 */
export function computeShare(amount, totalSpent) {
  if (!Number.isFinite(amount) || !Number.isFinite(totalSpent) || totalSpent <= 0) {
    return 0;
  }
  const share = amount / totalSpent;
  if (!Number.isFinite(share) || share <= 0) {
    return 0;
  }
  return Math.min(1, share);
}

/**
 * A share as display copy — the one rounding decision in this feature.
 *
 * Whole percent, no decimal: the bar beside it already carries the precision,
 * and a column of `34.2%` reads as more exactness than a pie-slice comparison
 * needs. **The rendered shares are therefore not guaranteed to sum to exactly
 * 100%**, and that is the deliberate choice of the two ADR 0022 §4 names: a
 * largest-remainder redistribution would make one category's printed
 * percentage disagree with its own `amount / totalSpent`, which is worse in a
 * finance app than a column that sums to 99%.
 *
 * `<1%` rather than `0%` for a small non-zero share: a category only appears
 * in this response at all if it has spend (zero-spend categories are omitted,
 * §14.1), so printing `0%` next to a real amount would contradict the row it
 * labels.
 *
 * @param {number} share 0..1, as returned by `computeShare`.
 * @returns {string} e.g. '34%', '<1%', '0%'
 */
export function formatSharePercent(share) {
  if (!Number.isFinite(share) || share <= 0) {
    return '0%';
  }
  const percent = share * 100;
  if (percent < 1) {
    return '<1%';
  }
  return `${Math.round(percent)}%`;
}

/**
 * The badge glyph for one breakdown entry. §14.1 returns `iconName` and `glyph`
 * from the category row as it is now, and this app renders the `glyph` — the
 * Unicode/letter placeholder convention it uses everywhere while
 * react-native-vector-icons remains approved-but-unlinked
 * (docs/decisions/0002-icon-library-selection.md). **`iconName` is held in the
 * store unread for exactly that reason**: when the icon font is linked, this one
 * function is what changes.
 *
 * The fallback is the first letter of the name — the same derivation
 * `utils/categories.js#buildCategoryCreateFields` applies when the app itself
 * creates a category, so a row with a missing glyph still gets the badge it
 * would have had.
 *
 * **Moved here from `components/CategoryBreakdownRow.jsx` on 2026-11-01**, when
 * the chart's outside labels became the second surface that needs it
 * (constitution §25 — the second caller is the threshold, and two copies of an
 * icon-fallback rule would diverge the moment the icon font lands). It takes a
 * §14.1 breakdown entry, which is this module's shape.
 *
 * @param {{ glyph?: string | null, categoryName: string }} entry
 * @returns {string}
 */
export function resolveBreakdownGlyph(entry) {
  return entry.glyph || entry.categoryName.charAt(0).toUpperCase();
}

/**
 * A parent's own direct spend — `amount` minus the sum of its
 * `subcategories[].amount` (§14.1).
 *
 * **Not a field, deliberately**, so this is the subtraction ADR 0022 §3 says
 * the one surface that wants it performs. A parent with no subcategory spend
 * carries `subcategories: []`, so this returns its whole `amount`.
 *
 * Done in whole paise via the shared `toPaise`, for the same reason
 * splitCalculations.js does it: subtracting decimal currency in floating point
 * leaves residue (`4200 - 1500.1 - 2699.9` is not reliably `0`), and a residue
 * of a thousandth of a rupee would render as a spurious direct-spend row.
 *
 * Floored at `0`: the contract makes children sum to no more than their
 * parent, and a negative "direct spend" is not a thing to render if it ever
 * does not.
 *
 * @param {{ amount: number, subcategories?: Array<{ amount: number }> }} entry
 *   One top-level §14.1 entry.
 * @returns {number} Rupees, exact to the paise.
 */
export function computeDirectSpend(entry) {
  const childPaise = (entry.subcategories ?? []).reduce(
    (total, subcategory) => total + toPaise(subcategory.amount),
    0,
  );
  return Math.max(0, toPaise(entry.amount) - childPaise) / 100;
}

/**
 * Decorates §14.1's `categories[]` with the two derived numbers the renderer
 * needs, at both levels.
 *
 * **Order is the server's and is never touched** — `amount` descending, ties
 * by `categoryName` ascending, specified at both levels (§14.1). `.map()`
 * preserves it; a client-side re-sort could only ever disagree with the
 * contract and make a list reshuffle between two identical requests.
 *
 * **Every share is a share of `totalSpent`, including a subcategory's**, not a
 * share of its parent. One scale for every bar on the screen is what makes a
 * nested bar read as a slice of the bar above it, and it is the division ADR
 * 0022 §4 names (`amount / totalSpent`). A share-of-parent number would be a
 * second, differently-based percentage in the same list.
 *
 * Nothing is renamed or reshaped (constitution §15/§30): entries keep the
 * API's own field names and gain `share`, plus `directSpend` on a parent.
 *
 * @param {object[]} categories §14.1's `categories[]`.
 * @param {number} totalSpent §14.1's `totalSpent`.
 * @returns {object[]} The same entries, in the same order, each with `share`;
 *   top-level entries also with `directSpend`.
 */
export function buildBreakdownRows(categories, totalSpent) {
  return categories.map((entry) => ({
    ...entry,
    share: computeShare(entry.amount, totalSpent),
    directSpend: computeDirectSpend(entry),
    subcategories: (entry.subcategories ?? []).map((subcategory) => ({
      ...subcategory,
      share: computeShare(subcategory.amount, totalSpent),
    })),
  }));
}

/**
 * Two inclusive bounds as display copy — "1 Oct 2026 – 31 Oct 2026".
 *
 * Reuses `getExactDateLabel` rather than formatting dates again (ADR 0019
 * §10.3's single-definition rule, applied to a date label instead of a path
 * separator). An en dash, not a hyphen: these are two bounds, not a
 * subtraction.
 *
 * Shared by the breakdown's own header and by the drill-down's, so the two
 * screens cannot describe one range two ways.
 *
 * @param {string} dateFrom `YYYY-MM-DD`
 * @param {string} dateTo `YYYY-MM-DD`
 * @returns {string}
 */
export function formatDateRange(dateFrom, dateTo) {
  return `${getExactDateLabel(dateFrom)} – ${getExactDateLabel(dateTo)}`;
}

/**
 * The range as display copy, prefixed by what the range *is* so the user knows
 * why those two dates and not two others.
 *
 * It was the only thing attributing the total while the tab had no range
 * picker; now that it has one (`resolveStatisticsRange`'s `monthsBack`) the
 * label is also the stepper's own caption, which is why `'past-month'` names
 * its month — `‹ September 2026 • 1 Sep 2026 – 30 Sep 2026 ›` says both which
 * period you stepped to and exactly what it covers. The three prefixes keep one
 * idiom: what the range is, then the bounds.
 *
 * @param {{ dateFrom: string, dateTo: string,
 *   source: 'budget-period' | 'calendar-month' | 'past-month' }} range
 * @returns {string}
 */
export function formatStatisticsRangeLabel({ dateFrom, dateTo, source }) {
  const dates = formatDateRange(dateFrom, dateTo);

  if (source === 'budget-period') {
    return `Budget period • ${dates}`;
  }
  if (source === 'past-month') {
    return `${getMonthYearLabel(dateFrom)} • ${dates}`;
  }
  return `This month • ${dates}`;
}
