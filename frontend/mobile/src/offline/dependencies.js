/**
 * Pure dependency rules for the outbox —
 * docs/decisions/0027-offline-first-local-cache-and-replay-sync.md §7.4/§8.6.
 *
 * Because every create carries its final, client-generated id (§3), an op
 * that references a still-pending entity only has to wait for that entity's
 * create — nothing is rewritten at flush time.
 *
 * `ledgerTargets` (an op field added by the split/settlement builders) names
 * the shared-ledger targets an op touches: `group:{groupId}` or
 * `contact:{contactId}`. It implements §7.4: a settlement never reaches the
 * server before an earlier split or settlement on the same target.
 */

// ADR 0028 §7.7: a settlement also waits for earlier queued edits and deletes
// of splits on the same target (`group:{id}`, `contact:{id}` or `pair:{id}`).
const LEDGER_OP_TYPES = new Set(['split.create', 'split.update', 'split.delete', 'settlement.create']);
const SATISFIED_STATUSES = new Set(['acked', 'superseded']);
const BLOCKING_STATUSES = new Set(['failed', 'blocked']);

/**
 * @param {object} op
 * @returns {boolean}
 */
function isUnacknowledged(op) {
  return !SATISFIED_STATUSES.has(op.status) && op.status !== 'discarded';
}

/**
 * @param {string[] | undefined} left
 * @param {string[] | undefined} right
 * @returns {boolean}
 */
function intersects(left, right) {
  if (!left || !right || left.length === 0 || right.length === 0) {
    return false;
  }
  const set = new Set(left);
  return right.some((value) => set.has(value));
}

/**
 * Every earlier, not-yet-acknowledged op that `newOp` must follow:
 * - same `entityId` (a create before its edits, an edit before a delete);
 * - an `entityId` that appears in `newOp.referencedIds` (a contact before the
 *   group that contains it, a category before the transaction that uses it);
 * - for a settlement: every earlier split/settlement on a shared ledger target.
 *
 * @param {object} newOp
 * @param {object[]} existingOps Earlier ops, in queue order.
 * @returns {string[]} opIds.
 */
export function computeDependsOn(newOp, existingOps) {
  const referenced = new Set(newOp.referencedIds || []);
  const isSettlement = newOp.type === 'settlement.create';

  return existingOps
    .filter((op) => op.opId !== newOp.opId && isUnacknowledged(op))
    .filter((op) => {
      if (op.entityId && op.entityId === newOp.entityId) {
        return true;
      }
      if (op.entityId && referenced.has(op.entityId)) {
        return true;
      }
      return (
        isSettlement &&
        LEDGER_OP_TYPES.has(op.type) &&
        intersects(op.ledgerTargets, newOp.ledgerTargets)
      );
    })
    .map((op) => op.opId);
}

/**
 * Whether an op may be sent now.
 * - `ready`: every dependency is acknowledged (or already pruned from the
 *   outbox, which only happens to acknowledged ops).
 * - `blocked`: a dependency failed permanently or is itself blocked.
 * - `wait`: a dependency is still pending or in flight.
 *
 * @param {object} op
 * @param {Record<string, object>} opsById
 * @returns {'ready' | 'wait' | 'blocked'}
 */
export function resolveDependencyState(op, opsById) {
  let state = 'ready';
  for (const dependencyId of op.dependsOn || []) {
    const dependency = opsById[dependencyId];
    if (!dependency || SATISFIED_STATUSES.has(dependency.status)) {
      continue;
    }
    if (BLOCKING_STATUSES.has(dependency.status)) {
      return 'blocked';
    }
    state = 'wait';
  }
  return state;
}

/**
 * Every op that depends on `opId`, directly or transitively, in queue order.
 * A Discard removes these with it (§8.6), and a permanent failure blocks them.
 *
 * @param {string} opId
 * @param {object[]} ops In queue order.
 * @returns {string[]}
 */
export function collectDependents(opId, ops) {
  const affected = new Set([opId]);
  const dependents = [];
  ops.forEach((op) => {
    if (affected.has(op.opId)) {
      return;
    }
    if ((op.dependsOn || []).some((dependencyId) => affected.has(dependencyId))) {
      affected.add(op.opId);
      dependents.push(op.opId);
    }
  });
  return dependents;
}

/**
 * Keys an op by `opId` for `resolveDependencyState`.
 *
 * @param {object[]} ops
 * @returns {Record<string, object>}
 */
export function indexOpsById(ops) {
  const byId = {};
  ops.forEach((op) => {
    byId[op.opId] = op;
  });
  return byId;
}
