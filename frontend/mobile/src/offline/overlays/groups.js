import { toLocalSyncStatus } from './activeOps';

/**
 * Groups overlay (list part) — ADR 0027 §8.8: a queued `group.create` is added
 * so pickers see it. Balance estimates are `overlays/balances.js`. Pure.
 *
 * @param {object[]} groups Snapshot.
 * @param {object[]} ops Active ops affecting `groups`, queue order.
 * @returns {object[]}
 */
export function overlayGroups(groups, ops) {
  if (ops.length === 0) {
    return groups;
  }
  const held = new Set(groups.map((group) => group.id));
  const added = ops
    .filter((op) => op.type === 'group.create' && op.preview?.group && !held.has(op.entityId))
    .map((op) => ({
      id: op.entityId,
      name: op.preview.group.name,
      members: op.preview.group.members ?? [],
      yourBalance: 0,
      lastActivity: null,
      createdByUserId: null,
      localSyncStatus: toLocalSyncStatus(op),
    }))
    .reverse();
  return added.length === 0 ? groups : [...added, ...groups];
}
