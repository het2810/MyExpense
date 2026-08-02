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

// A money entry: digits with at most 2 decimals ("12", "12.", "12.5",
// "12.50", ".5"). Anything else — a sign, a second dot, a third decimal,
// letters — is not an amount.
const AMOUNT_TEXT_PATTERN = /^(\d+(\.\d{0,2})?|\.\d{1,2})$/;

/**
 * Parses one raw amount TextInput value for "Who paid?". Blank means 0
 * (ADR 0025 §8.4). Returns `NaN` for text that is not a non-negative amount
 * with at most 2 decimals, so the caller can block the confirm instead of
 * silently reading `"12abc"` as 12.
 *
 * @param {string | undefined} text
 * @returns {number}
 */
function parsePayerAmountText(text) {
  const trimmed = (text ?? '').trim();
  if (trimmed === '') {
    return 0;
  }
  return AMOUNT_TEXT_PATTERN.test(trimmed) ? parseFloat(trimmed) : NaN;
}

/**
 * "Who paid?" (docs/decisions/0025-multiple-payers-per-split-expense.md §8.4)
 * — the per-person paid amounts, validated in paise-integer arithmetic.
 *
 * Valid only when every non-blank entry is a number ≥ 0 with at most 2
 * decimals, the entries sum **exactly** (to the paise) to `totalAmount`, and at
 * least one entry is greater than 0.
 *
 * `payers` holds only the entries greater than 0, in roster order, as
 * `{ participantId, amount }` — the `splitConfig.payers` shape (§8.1). Blank and
 * zero entries are dropped: a person who paid nothing is not a payer (the
 * server's `amount > 0` rule, §5.1 R5).
 *
 * `status` drives the live helper line: `'under'` (₹X left), `'exact'`, or
 * `'over'` (₹X over).
 *
 * @param {Array<{ participantId: string }>} participants
 * @param {number} totalAmount
 * @param {Object<string, string>} amountTextMap `{ [participantId]: string }`
 * @returns {{ isValid: boolean, hasInvalidEntry: boolean, assignedAmount: number,
 *   remainingAmount: number, status: 'under' | 'exact' | 'over',
 *   payers: Array<{ participantId: string, amount: number }> }}
 */
export function validatePayerAmounts(participants, totalAmount, amountTextMap) {
  const totalPaise = toPaise(totalAmount);
  let assignedPaise = 0;
  let hasInvalidEntry = false;
  const payers = [];

  (participants ?? []).forEach((participant) => {
    const parsed = parsePayerAmountText(amountTextMap?.[participant.participantId]);
    if (Number.isNaN(parsed)) {
      hasInvalidEntry = true;
      return;
    }
    const paise = toPaise(parsed);
    assignedPaise += paise;
    if (paise > 0) {
      payers.push({ participantId: participant.participantId, amount: paise / 100 });
    }
  });

  const remainingPaise = totalPaise - assignedPaise;
  let status = 'exact';
  if (remainingPaise > 0) {
    status = 'under';
  } else if (remainingPaise < 0) {
    status = 'over';
  }

  return {
    isValid: !hasInvalidEntry && remainingPaise === 0 && payers.length > 0,
    hasInvalidEntry,
    assignedAmount: assignedPaise / 100,
    remainingAmount: remainingPaise / 100,
    status,
    payers,
  };
}

/**
 * The payer half of a `splitConfig` for a confirmed "Who paid?" result
 * (ADR 0025 §8.4 Confirm): two or more payers stay multi-payer; exactly one
 * collapses to single-payer mode, because multi-payer with one payer is just a
 * single payer and nothing downstream should have to tell them apart.
 *
 * @param {Array<{ participantId: string, amount: number }>} payers Entries > 0.
 * @returns {{ paidById: string | null,
 *   payers: Array<{ participantId: string, amount: number }> | null }}
 */
export function toPayerSelection(payers) {
  if (Array.isArray(payers) && payers.length === 1) {
    return { paidById: payers[0].participantId, payers: null };
  }
  return { paidById: null, payers };
}

/**
 * A `splitConfig` with its payer half replaced by a "Who paid?" result, and
 * everything else — method and every participant's consumed share — kept.
 * Used when Who Paid? is opened straight from How Was This Split?'s "Paid by
 * multiple people" row and returns to Split Add Expense rather than to Adjust
 * Split: who paid changes, how the bill is shared does not.
 *
 * Exactly one of `paidById`/`payers` is set on the result (ADR 0025 §8.1).
 *
 * @param {object} splitConfig The config in effect when Who Paid? opened.
 * @param {{ paidById: string | null, payers: Array<{ participantId: string,
 *   amount: number }> | null }} payersSelection From `toPayerSelection`.
 * @returns {object}
 */
export function applyPayerSelection(splitConfig, payersSelection) {
  return {
    ...splitConfig,
    paidById: payersSelection.paidById ?? null,
    payers: payersSelection.payers ?? null,
  };
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
