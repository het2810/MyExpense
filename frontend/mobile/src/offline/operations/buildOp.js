import { newId } from '../ids';
import { getOps } from '../outbox';
import { computeDependsOn } from '../dependencies';
import { getIsOnline } from '../connectivity';
import { OUTBOX_SCHEMA_VERSION } from '../config';

/**
 * Completes an op record (docs/decisions/0027-offline-first-local-cache-and-replay-sync.md §8.5)
 * from a domain builder's partial: assigns the `opId` (= `Idempotency-Key`),
 * fixes `clientUpdatedAt` (= `X-Client-Updated-At`) at enqueue time, records
 * whether the device was online, and computes `dependsOn` against the current
 * queue.
 *
 * @param {{ type: string, entityType: string, entityId: string, method: string,
 *   path: string, body?: object, referencedIds?: string[], affects: string[],
 *   preview?: object, ledgerTargets?: string[] }} partial
 * @param {{ now?: Date, existingOps?: object[] }} [options] Injectable for tests.
 * @returns {object}
 */
export function buildOp(partial, { now = new Date(), existingOps } = {}) {
  const createdAt = now.toISOString();
  const op = {
    v: OUTBOX_SCHEMA_VERSION,
    opId: newId(),
    type: partial.type,
    entityType: partial.entityType,
    entityId: partial.entityId,
    method: partial.method,
    path: partial.path,
    body: partial.body,
    clientUpdatedAt: createdAt,
    enqueuedOnline: getIsOnline(),
    referencedIds: (partial.referencedIds || []).filter(Boolean),
    ledgerTargets: partial.ledgerTargets || [],
    dependsOn: [],
    affects: partial.affects,
    preview: partial.preview || {},
    status: 'pending',
    attempts: 0,
    nextAttemptAt: null,
    lastError: null,
    ackedAt: null,
    createdAt,
  };
  op.dependsOn = computeDependsOn(op, existingOps ?? getOps());
  return op;
}
