import { getDateDisplayLabel, toIsoDateString } from './dateDisplay';

/**
 * Pure derivations over the two balance lists the Split tab renders —
 * `IndividualBalanceResponse[]` (docs/api/api-overview.md §8.1) and
 * `GroupResponse[]` (§7.1).
 *
 * Kept out of the screen per constitution §8, and kept apart from
 * `utils/splitCalculations.js` (which owns the five split *methods*) because
 * these answer a different question: what the already-computed server balances
 * add up to, and how one of them reads as a subtitle.
 *
 * ---
 * **EVERY BALANCE HERE IS ALREADY ORIENTED TO THE CALLER. NOTHING IS NEGATED.**
 *
 * `IndividualBalanceResponse.balance` and `GroupResponse.yourBalance` are both
 * signed from the signed-in user's point of view: **positive = you are owed,
 * negative = you owe**. For a pair that sign has already been flipped exactly
 * once, server-side, when the caller is the canonical `counterpart_user_id`
 * (ADR 0023 §1.4, `IndividualBalanceService#orientToCaller`). A second flip
 * anywhere on this side would render every debt backwards while looking
 * entirely plausible, so this module only ever takes magnitudes with
 * `Math.abs` after testing the sign — it never multiplies by `-1`.
 */

/**
 * The Split tab's two summary cards: what the user owes in total, and what they
 * are owed in total, across **both** tabs.
 *
 * Summing is legitimate here in a way it deliberately is not for transactions:
 * §8.1 and §7.1 are both **unpaginated**, so these are totals over complete
 * lists rather than over one page (the error ADR 0022 §6 names). The caller
 * must still only render them once *both* reads have succeeded — a total
 * missing one of its two inputs is a wrong number with a confident label.
 *
 * The two figures are returned as **positive magnitudes** because that is how
 * they are rendered ("YOU OWE ₹1,400"), with the direction carried by which
 * field it is. A settled (`0`) row contributes to neither.
 *
 * @param {{ balances?: object[], groups?: object[] }} lists
 * @returns {{ totalYouOwe: number, totalYouAreOwed: number }}
 */
export function summarizeSplitBalances({ balances = [], groups = [] }) {
  let owed = 0;
  let owing = 0;

  const add = (value) => {
    if (!Number.isFinite(value)) {
      return;
    }
    if (value > 0) {
      owed += value;
    } else if (value < 0) {
      owing += Math.abs(value);
    }
  };

  balances.forEach((entry) => add(entry.balance));
  groups.forEach((group) => add(group.yourBalance));

  return { totalYouOwe: owing, totalYouAreOwed: owed };
}

/**
 * An `IndividualBalanceResponse` row's subtitle.
 *
 * §8.1 carries **no activity summary** — the `'Dinner split • 3 days ago'`
 * strings the Individual tab used to show came from the mock store and have no
 * field behind them. `updatedAt` is the only temporal fact the endpoint states,
 * so the subtitle says exactly what that is and nothing more. Inventing a
 * description of the last expense would mean a second read per row (§9.3 is
 * per-target) to render a line nobody asked for.
 *
 * The timestamp is converted to the **device's** calendar date before being
 * labelled, so a balance updated at 23:30 UTC does not read as "Yesterday" to a
 * user whose own clock has already rolled over.
 *
 * @param {string | null | undefined} updatedAt An ISO timestamp.
 * @returns {string} e.g. 'Updated Today', or '' when there is no timestamp.
 */
export function describeBalanceUpdatedAt(updatedAt) {
  const localDate = toLocalIsoDate(updatedAt);
  return localDate ? `Updated ${getDateDisplayLabel(localDate)}` : '';
}

/**
 * A `GroupResponse` row's subtitle: the member count, plus `lastActivity` only
 * if it is actually populated.
 *
 * **`lastActivity` is never written by the backend** — it is in the contract
 * (§7.1) and no write path fills it, deliberately, because the frontend's own
 * format is a client-side relative date frozen into a column shared by readers
 * in different timezones (`backend/README.md` §16.6 assumption 20). So it
 * arrives `null` on every row today and this helper must not depend on it. It
 * is still *read* rather than ignored, so that the day it starts arriving the
 * subtitle improves without a code change.
 *
 * **`members.length` is the member count, not `members.length + 1`** — the
 * creator is always a member server-side (§7.1), unlike the old mock shape
 * whose `memberContactIds` excluded the current user.
 *
 * @param {object} group A `GroupResponse` (§7.1).
 * @returns {string}
 */
export function describeGroupSubtitle(group) {
  const memberCount = Array.isArray(group?.members) ? group.members.length : 0;
  const members = `${memberCount} ${memberCount === 1 ? 'member' : 'members'}`;
  return group?.lastActivity ? `${members} • ${group.lastActivity}` : members;
}

/**
 * An ISO timestamp -> the `YYYY-MM-DD` date it falls on **in the device's own
 * timezone**, which is the calendar `getDateDisplayLabel` compares against.
 *
 * Slicing the first ten characters would take the date in whatever zone the
 * server serialised in and silently shift a label by a day near midnight.
 *
 * @param {string | null | undefined} isoTimestamp
 * @returns {string} '' when the value is absent or unparseable.
 */
function toLocalIsoDate(isoTimestamp) {
  if (typeof isoTimestamp !== 'string' || isoTimestamp.length === 0) {
    return '';
  }
  const parsed = new Date(isoTimestamp);
  return Number.isNaN(parsed.getTime()) ? '' : toIsoDateString(parsed);
}
