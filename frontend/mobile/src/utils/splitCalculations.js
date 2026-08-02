/**
 * Pure calculation functions backing Adjust Split's five split methods —
 * docs/decisions/0005-split-add-expense-flow.md §5.4-§5.8. Kept out of
 * AdjustSplitScreen.jsx per constitution §8 ("business logic belongs inside
 * hooks or services, never directly inside components") and §26 (file size
 * guidelines) — this is architecturally significant, formula-heavy logic
 * that deserves to live somewhere it can be read (and eventually tested) on
 * its own, independent of any component/render concerns.
 *
 * Every function takes the same first two arguments (`participants`,
 * `totalAmount`) plus one tab-specific input, and returns an object whose
 * `participantAmounts` shape always matches ADR 0005 §2.3's
 * `{ participantId, name, amount }[]` — ready to hand directly to
 * `navigation.popTo('SplitAddExpense', { splitConfig: { method, paidById,
 * participantAmounts } })`.
 */
import { toPaise, allocateByWeights } from './currency';

/**
 * Equally tab (§5.4). `checkedMap` is `{ [participantId]: boolean }` — a
 * missing entry defaults to checked (true), matching the tab's own
 * "default: all checked" rule.
 */
export function calculateEquallySplit(participants, totalAmount, checkedMap) {
  const weights = participants.map((participant) =>
    checkedMap[participant.participantId] === false ? 0 : 1,
  );
  const checkedCount = weights.filter((weight) => weight > 0).length;
  const amounts = allocateByWeights(totalAmount, weights);

  const participantAmounts = participants.map((participant, index) => ({
    participantId: participant.participantId,
    name: participant.name,
    amount: amounts[index],
  }));

  const isValid = checkedCount > 0;

  return {
    isValid,
    errorMessage: isValid ? null : 'Select at least one person.',
    participantAmounts,
    checkedCount,
    perPersonAmount: checkedCount > 0 ? totalAmount / checkedCount : 0,
  };
}

/**
 * Unequally tab (§5.5). `amountTextMap` is `{ [participantId]: string }` —
 * raw TextInput values; blank entries count as 0.
 */
export function calculateUnequallySplit(participants, totalAmount, amountTextMap) {
  const parsedAmounts = participants.map(
    (participant) => parseFloat(amountTextMap[participant.participantId]) || 0,
  );
  const sumEntered = parsedAmounts.reduce((sum, value) => sum + value, 0);
  const remaining = totalAmount - sumEntered;

  const participantAmounts = participants.map((participant, index) => ({
    participantId: participant.participantId,
    name: participant.name,
    amount: parsedAmounts[index],
  }));

  // Paise-safe comparison — same precedent as ADR 0003's 2026-08-10
  // Amendment, Part A (Cash + Online must equal the total amount).
  const isValid = toPaise(sumEntered) === toPaise(totalAmount);

  return { isValid, participantAmounts, sumEntered, remaining };
}

/**
 * By percentages tab (§5.6). `percentTextMap` is
 * `{ [participantId]: string }`. Fractional percentages are allowed.
 *
 * Returns both the paise-exact `participantAmounts` (the stored value, via
 * the shared §5.3 allocation rule with `w_i = enteredPercent_i`) and a
 * separate `displayAmounts` array — the naive, independently-computed
 * `totalAmount * percent / 100` per row used only for the live per-row
 * label, which is not guaranteed to sum exactly to `totalAmount` (§5.3's
 * explicitly-flagged display-vs-storage distinction).
 */
export function calculatePercentageSplit(participants, totalAmount, percentTextMap) {
  const parsedPercents = participants.map(
    (participant) => parseFloat(percentTextMap[participant.participantId]) || 0,
  );
  const sumPercent = parsedPercents.reduce((sum, value) => sum + value, 0);

  // Basis-point-safe comparison (hundredths of a percent) — the
  // percentage-domain equivalent of paise-safety, per §5.6.
  const sumBasisPoints = parsedPercents.reduce(
    (sum, value) => sum + Math.round(value * 100),
    0,
  );
  const isValid = sumBasisPoints === 10000;

  const amounts = allocateByWeights(totalAmount, parsedPercents);
  const participantAmounts = participants.map((participant, index) => ({
    participantId: participant.participantId,
    name: participant.name,
    amount: amounts[index],
  }));

  const displayAmounts = parsedPercents.map((percent) => (totalAmount * percent) / 100);

  return { isValid, participantAmounts, displayAmounts, sumPercent };
}

/**
 * By shares tab (§5.7). `shareTextMap` is `{ [participantId]: string }` —
 * non-negative integers only (parsed with `parseInt`, base 10). Blank or
 * invalid entries default to 0 shares.
 */
export function calculateSharesSplit(participants, totalAmount, shareTextMap) {
  const parsedShares = participants.map((participant) => {
    const parsed = parseInt(shareTextMap[participant.participantId], 10);
    return Number.isNaN(parsed) || parsed < 0 ? 0 : parsed;
  });
  const totalShares = parsedShares.reduce((sum, value) => sum + value, 0);
  const isValid = totalShares > 0;

  const amounts = allocateByWeights(totalAmount, parsedShares);
  const participantAmounts = participants.map((participant, index) => ({
    participantId: participant.participantId,
    name: participant.name,
    amount: amounts[index],
  }));

  return { isValid, participantAmounts, totalShares };
}

/**
 * By adjustment tab (§5.8) — the exact formula, named precisely per the
 * ADR's own variable names:
 *
 * - `equalBaseShares[i]` — participant i's starting share before any
 *   adjustment, via the §5.3 allocation rule across all N participants
 *   (equal weights), so it sums exactly to `totalAmount` before adjustment.
 * - A participant counts as "adjusted" iff their `+` field is non-blank AND
 *   parses to a value `> 0`. A blank field and an explicit `0` are both
 *   "not adjusted" (§5.8's deliberate simplification — both have no
 *   mathematical effect).
 * - `finalAmount_i = equalBaseShares[i] + adjustment_i` for adjusted i.
 * - `remainderForUnadjusted = totalAmount - sumAdjustedFinal`, distributed
 *   across the unadjusted participants via the §5.3 allocation rule (equal
 *   weights among just the unadjusted group) so it sums exactly.
 *
 * Note: the ADR's prose formula writes `k × equalBaseShare` using a single
 * scalar "equalBaseShare." This implementation instead sums each adjusted
 * participant's *own* allocated base share (`equalBaseShares[i]`, which can
 * differ from another participant's by at most one paisa when `totalAmount`
 * doesn't divide evenly by N) rather than a single uniform number — the
 * exact-sum invariant the rest of §5.3 is built on requires this, and
 * constitution §29 places correctness above literal-formula-matching when
 * the two are in tension for a non-evenly-divisible total.
 *
 * Block conditions (paise-safe, both from §5.8):
 * 1. `u === 0 AND toPaise(remainderForUnadjusted) !== 0` → block (nobody
 *    left to absorb a nonzero remainder).
 * 2. `u > 0 AND toPaise(remainderForUnadjusted) < 0` → block (adjustments
 *    already exceed the total).
 *
 * @param {Array<{participantId: string, name: string}>} participants
 * @param {number} totalAmount
 * @param {Object<string, string>} adjustmentTextMap
 */
export function calculateAdjustmentSplit(participants, totalAmount, adjustmentTextMap) {
  const equalBaseShares = allocateByWeights(
    totalAmount,
    participants.map(() => 1),
  );

  function isAdjusted(participantId) {
    const raw = adjustmentTextMap[participantId];
    if (raw === undefined || raw === null || `${raw}`.trim() === '') {
      return false;
    }
    const parsed = parseFloat(raw);
    return !Number.isNaN(parsed) && parsed > 0;
  }

  function getAdjustmentValue(participantId) {
    const parsed = parseFloat(adjustmentTextMap[participantId]);
    return !Number.isNaN(parsed) && parsed > 0 ? parsed : 0;
  }

  const adjustedIndices = [];
  const unadjustedIndices = [];
  participants.forEach((participant, index) => {
    if (isAdjusted(participant.participantId)) {
      adjustedIndices.push(index);
    } else {
      unadjustedIndices.push(index);
    }
  });

  const unadjustedCount = unadjustedIndices.length;

  const sumAdjustedFinal = adjustedIndices.reduce((sum, index) => {
    return sum + equalBaseShares[index] + getAdjustmentValue(participants[index].participantId);
  }, 0);

  const remainderForUnadjusted = totalAmount - sumAdjustedFinal;

  let isValid = true;
  let errorMessage = null;

  if (unadjustedCount === 0 && toPaise(remainderForUnadjusted) !== 0) {
    isValid = false;
    errorMessage =
      'Adjustments must add up to exactly the total amount when everyone has an adjustment.';
  } else if (unadjustedCount > 0 && toPaise(remainderForUnadjusted) < 0) {
    isValid = false;
    errorMessage =
      'These adjustments already add up to more than the total amount. Reduce an adjustment to continue.';
  }

  const unadjustedAmounts =
    unadjustedCount > 0
      ? allocateByWeights(
          remainderForUnadjusted,
          unadjustedIndices.map(() => 1),
        )
      : [];

  const amounts = new Array(participants.length).fill(0);
  adjustedIndices.forEach((index) => {
    amounts[index] = equalBaseShares[index] + getAdjustmentValue(participants[index].participantId);
  });
  unadjustedIndices.forEach((index, position) => {
    amounts[index] = unadjustedAmounts[position];
  });

  const participantAmounts = participants.map((participant, index) => ({
    participantId: participant.participantId,
    name: participant.name,
    amount: amounts[index],
  }));

  return {
    isValid,
    errorMessage,
    participantAmounts,
    equalBaseShares,
  };
}

/**
 * Shared balance -> trailing text/subtext/tone formatting — promoted from a
 * private helper in SplitGroupsListScreen.jsx into this shared utility file
 * (docs/decisions/0009-split-detail-and-settle-up.md §8), unchanged in
 * behavior, so SplitDetailScreen.jsx's per-expense rows can reuse the exact
 * same green/red/neutral convention SplitGroupsListScreen.jsx's aggregate
 * cards already use. Originally introduced by docs/decisions/
 * 0004-split-individual-tab.md §2 (the logic only ever reads a
 * `yourBalance`-shaped number, which both entry shapes carry).
 *
 * @param {number} yourBalance
 * @param {string} currencySymbol
 * @returns {{ trailingText: string, trailingSubtext: string|undefined, trailingTone: 'positive'|'negative'|'neutral' }}
 */
export function getBalanceTrailing(yourBalance, currencySymbol) {
  const isPositive = yourBalance > 0;
  const isSettled = yourBalance === 0;
  const trailingText = isSettled
    ? 'Settled up'
    : `${isPositive ? '+' : '-'}${currencySymbol}${Math.abs(yourBalance).toLocaleString('en-IN')}`;

  return {
    trailingText,
    trailingSubtext: isSettled ? undefined : isPositive ? 'you lent' : 'you owe',
    trailingTone: isSettled ? 'neutral' : isPositive ? 'positive' : 'negative',
  };
}
