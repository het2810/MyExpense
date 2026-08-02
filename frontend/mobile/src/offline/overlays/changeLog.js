import { toLocalSyncStatus } from './activeOps';

/**
 * Change-log overlay — ADR 0027 §6.6: offline, the per-entity log shows the
 * cached server entries plus the entity's pending queue ops, labelled
 * "Waiting to sync". A pending op is rendered as a pseudo-entry with the
 * fields it is trying to set (`before` is unknown on the device). Pure.
 */

/**
 * @param {object} op
 * @returns {'create' | 'update' | 'delete'}
 */
function toOperation(op) {
  if (op.method === 'DELETE') {
    return 'delete';
  }
  if (op.type.endsWith('.create')) {
    return 'create';
  }
  return 'update';
}

/**
 * Field-level "after" values from the queued body. `version` and `id` are
 * delivery details, never logged fields (§6.3).
 *
 * @param {object} op
 * @returns {Array<{ field: string, before: null, after: unknown }>}
 */
function toChanges(op) {
  const body = op.body || {};
  return Object.keys(body)
    .filter((field) => field !== 'version' && field !== 'id')
    .map((field) => ({ field, before: null, after: body[field] }));
}

/**
 * @param {object[]} entries Cached `ChangeLogEntryResponse[]`, newest first.
 * @param {object[]} ops All outbox ops, queue order.
 * @param {string} entityId
 * @returns {object[]} Pending pseudo-entries (newest first) followed by `entries`.
 */
export function overlayChangeLog(entries, ops, entityId) {
  const pending = ops
    .filter((op) => op.entityId === entityId && toLocalSyncStatus(op) !== null)
    .map((op) => ({
      id: `pending:${op.opId}`,
      entityType: op.entityType,
      entityId: op.entityId,
      operation: toOperation(op),
      outcome: null,
      supersededReason: null,
      supersededByChangeLogId: null,
      changes: toChanges(op),
      origin: null,
      deviceId: null,
      clientUpdatedAt: op.clientUpdatedAt,
      effectiveWriteAt: null,
      createdAt: null,
      localSyncStatus: toLocalSyncStatus(op),
    }))
    .reverse();
  return pending.length === 0 ? entries : [...pending, ...entries];
}
