/**
 * Shared date-display formatting for transactions — the single pure
 * function described in docs/ui/design-system.md Section 7.5 /
 * docs/decisions/0003-payment-mode-and-date-tracking.md Section 3. Used by
 * every screen that renders a transaction's `date` field (a stored
 * `YYYY-MM-DD` string, see useTransactionsStore.js) and by Add Expense's
 * date-picker trigger field. Written once here per constitution Section 8
 * (formatting/business logic doesn't belong inline in components) and
 * Section 25 (extract on second+ duplication).
 */

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Boundary for the "N days ago" bucket (design-system.md Section 7.5, steps
// 2-4): 2 through 6 days ago render as "N days ago"; 7+ (or a negative,
// clock-skew/future-date diff) renders as an actual formatted date.
const N_DAYS_AGO_MAX = 6;

/**
 * Builds a local-midnight timestamp for a given calendar day, so day-diffing
 * compares whole calendar days rather than raw instants — avoids the
 * timezone/DST off-by-one bugs that come from diffing arbitrary times of day
 * or from parsing a date-only string as UTC (`new Date('2026-08-10')`).
 */
function toLocalMidnight(year, month, day) {
  return new Date(year, month - 1, day).getTime();
}

/**
 * Parses a stored `YYYY-MM-DD` string into a local `Date` (local midnight,
 * not UTC midnight) — used to seed the native date picker's `value` from
 * Add Expense's `selectedDate` state.
 * @param {string} isoDate
 * @returns {Date}
 */
export function parseIsoDate(isoDate) {
  const [year, month, day] = isoDate.split('-').map(Number);
  return new Date(year, month - 1, day);
}

/**
 * Formats a `Date` (as returned by the native date picker) back into the
 * stored `YYYY-MM-DD` shape, using the date's local calendar components —
 * not `toISOString()`, which converts to UTC first and can shift the date
 * by a day near midnight in timezones ahead of UTC.
 * @param {Date} date
 * @returns {string}
 */
export function toIsoDateString(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Today's date as a `YYYY-MM-DD` string — the date picker's default value
 * and Add Expense's initial `selectedDate` state.
 * @returns {string}
 */
export function getTodayIsoDate() {
  return toIsoDateString(new Date());
}

/**
 * Computes the display label for a transaction's stored `YYYY-MM-DD` date:
 * "Today" / "Yesterday" / "N days ago" (2-6) / an actual formatted date
 * (7+ days, or a negative diff as a defensive fallback for clock skew).
 *
 * @param {string} isoDate - date-only string, e.g. '2026-08-10'
 * @returns {string} the computed display label
 */
export function getDateDisplayLabel(isoDate) {
  if (!isoDate) {
    return '';
  }

  const [year, month, day] = isoDate.split('-').map(Number);
  const transactionMs = toLocalMidnight(year, month, day);

  const now = new Date();
  const todayMs = toLocalMidnight(now.getFullYear(), now.getMonth() + 1, now.getDate());

  const diffDays = Math.round((todayMs - transactionMs) / MS_PER_DAY);

  if (diffDays === 0) {
    return 'Today';
  }
  if (diffDays === 1) {
    return 'Yesterday';
  }
  if (diffDays >= 2 && diffDays <= N_DAYS_AGO_MAX) {
    return `${diffDays} days ago`;
  }

  // diffDays >= 7, or negative (defensive — should not occur given the date
  // picker disallows future dates, per design-system.md Section 7.5).
  const transactionDate = new Date(year, month - 1, day);
  return transactionDate.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/**
 * Always-formatted date label for a transaction's stored `YYYY-MM-DD` date —
 * unlike getDateDisplayLabel, never returns a relative label
 * ("Today"/"2 days ago"); Transaction Detail always wants the exact date
 * (docs/decisions/0007-transaction-detail-screen.md §1). Reuses the exact
 * same `toLocaleDateString('en-IN', {...})` call getDateDisplayLabel already
 * uses in its own 7-plus-days branch, applied unconditionally instead of
 * only past a threshold.
 * @param {string} isoDate - 'YYYY-MM-DD'
 * @returns {string} e.g. '13 Aug 2026'
 */
export function getExactDateLabel(isoDate) {
  if (!isoDate) {
    return '';
  }

  const [year, month, day] = isoDate.split('-').map(Number);
  const transactionDate = new Date(year, month - 1, day);
  return transactionDate.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/**
 * 24-hour 'HH:mm' -> 12-hour display label (ADR 0007 §1 / ADR 0003's
 * 2026-08-13 amendment). Pure formatting only — the stored value stays a
 * locale-independent 24-hour string; this is the display-only conversion,
 * mirroring the separation of concerns already established between `date`
 * and getDateDisplayLabel/getExactDateLabel.
 * @param {string} time - 'HH:mm', e.g. '14:45'
 * @returns {string} e.g. '2:45 PM'
 */
export function getTimeLabel(time) {
  if (!time) {
    return '';
  }

  const [hours, minutes] = time.split(':').map(Number);
  const period = hours >= 12 ? 'PM' : 'AM';
  const twelveHour = hours % 12 === 0 ? 12 : hours % 12;
  const paddedMinutes = String(minutes).padStart(2, '0');
  return `${twelveHour}:${paddedMinutes} ${period}`;
}

/**
 * Current wall-clock time as 'HH:mm' — mirrors getTodayIsoDate()'s existing
 * precedent, used to default AddExpenseScreen's new TIME field to "now" on
 * create (ADR 0007 §1).
 * @returns {string}
 */
export function getCurrentTimeString() {
  const now = new Date();
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}
