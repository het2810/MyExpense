/**
 * Shared currency-rounding primitives, used across Add Expense and the
 * Split Add Expense flow — docs/decisions/0005-split-add-expense-flow.md
 * §5.3.
 *
 * `toPaise` was previously a private helper duplicated inline in
 * AddExpenseScreen.jsx. Per constitution §25 (a correctness-critical
 * rounding primitive should have exactly one implementation, not two copies
 * that could silently drift) it is promoted here and imported by both
 * AddExpenseScreen.jsx and the new AdjustSplitScreen.jsx / splitCalculations.js.
 */

/**
 * Converts a decimal currency value to whole paise (integer), so amounts
 * can be compared against a total without raw floating-point decimal
 * equality (`33.33 + 66.67` is not guaranteed to `=== 100` bit-for-bit in
 * JS).
 * @param {number} value
 * @returns {number}
 */
export function toPaise(value) {
  return Math.round(value * 100);
}

/**
 * The paise-exact allocation rule — docs/decisions/0005-split-add-expense-flow.md
 * §5.3, "one algorithm, reused across three [Adjust Split] tabs" (Equally,
 * By percentages, By shares), and also reused by Split Add Expense's default
 * equal-split computation and How Was This Expense Split's 2-participant/
 * N-participant "split equally" presets.
 *
 * Given a total amount and a list of non-negative weights (one per
 * participant, in stable display order — self first, then contact/group
 * members in their existing order), returns an amount per participant that
 * sums EXACTLY to `totalAmount`, by construction, regardless of individual
 * rounding:
 * - Every participant except the last gets `round(totalPaise * weight_i / totalWeight)`.
 * - The last participant absorbs whatever rounding remainder is left:
 *   `totalPaise - sum(all other allocated paise)`.
 *
 * A weight of `0` (an unchecked person in Equally, or `0%`/`0` shares)
 * correctly yields an amount of `0` with no special-casing. If every weight
 * is `0` (e.g. nobody checked yet, or all shares still blank), every
 * participant gets `0` rather than dividing by zero.
 *
 * @param {number} totalAmount
 * @param {number[]} weights - same length/order as the participant list
 * @returns {number[]} amounts, same length/order as `weights`, summing exactly to `totalAmount`
 */
export function allocateByWeights(totalAmount, weights) {
  const totalPaise = toPaise(totalAmount);
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);

  if (totalWeight <= 0) {
    return weights.map(() => 0);
  }

  const amounts = [];
  let allocatedPaise = 0;

  weights.forEach((weight, index) => {
    if (index === weights.length - 1) {
      amounts.push((totalPaise - allocatedPaise) / 100);
      return;
    }
    const paise = Math.round((totalPaise * weight) / totalWeight);
    allocatedPaise += paise;
    amounts.push(paise / 100);
  });

  return amounts;
}
