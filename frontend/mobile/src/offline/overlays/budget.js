/**
 * Budget overlay — ADR 0027 §8.8: a queued `budget.save` replaces (or sets)
 * the active period. The last one in queue order wins, as it will on the
 * server. Used by the post-auth gate offline (§8.4 step 2) and by every
 * budget reader.
 *
 * Pure.
 *
 * @param {object | null} activePeriod Snapshot.
 * @param {object[]} ops Active ops affecting `budget`, queue order.
 * @returns {object | null}
 */
export function overlayBudget(activePeriod, ops) {
  let period = activePeriod;
  ops.forEach((op) => {
    if (op.type === 'budget.save' && op.preview?.period) {
      period = { ...op.preview.period, amount: Number(op.preview.period.amount) };
    }
  });
  return period;
}
