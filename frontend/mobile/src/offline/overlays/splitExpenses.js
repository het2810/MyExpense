import { toLocalSyncStatus } from './activeOps';

/**
 * Split-expense list overlay — ADR 0027 §8.8: a queued `split.create` is
 * added to its target's list (newest first) as a minimal row built from the
 * request body. The server's full `SplitExpenseResponse` replaces it on the
 * next pull. Pure.
 *
 * ADR 0028 §7.7: a queued `split.update` replaces its row with the projected
 * split and a queued `split.delete` removes it (this list never shows deleted
 * splits, unlike the feed).
 *
 * @param {object[]} rows Snapshot rows for one target.
 * @param {object[]} ops Active ops affecting `splitExpenses`, queue order.
 * @param {{ groupId?: string | null, counterpartContactId?: string | null }} target
 * @returns {object[]}
 */
export function overlaySplitExpenses(rows, ops, target) {
  if (ops.length === 0) {
    return rows;
  }
  let current = rows;
  ops.forEach((op) => {
    if (op.type === 'split.update' && op.preview?.after) {
      current = current.map((row) => (row.id === op.entityId ? { ...op.preview.after } : row));
    }
    if (op.type === 'split.delete') {
      current = current.filter((row) => row.id !== op.entityId);
    }
  });
  const held = new Set(current.map((row) => row.id));
  const added = ops
    .filter((op) => op.type === 'split.create' && !held.has(op.entityId))
    .filter((op) => {
      if (target.groupId) {
        return op.body?.groupId === target.groupId;
      }
      if (!target.counterpartContactId) {
        return false;
      }
      const contactIds = op.body?.individualCounterpartContactIds ?? [
        op.body?.individualCounterpartContactId,
      ];
      return contactIds.includes(target.counterpartContactId);
    })
    .map((op) => ({
      id: op.entityId,
      title: op.body.title,
      amount: op.body.amount,
      splitDate: op.body.splitDate,
      splitMode: op.body.splitMode,
      groupId: op.body.groupId ?? null,
      categoryId: op.body.categoryId ?? null,
      categoryName: op.preview?.categorySnapshot?.categoryName ?? 'Misc',
      parentCategoryName: null,
      categoryIconName: op.preview?.categorySnapshot?.categoryIconName ?? null,
      categoryGlyph: op.preview?.categorySnapshot?.categoryGlyph ?? 'M',
      categoryTone: 'neutral',
      counterparts: [],
      participants: [],
      payers: [],
      isLocalPreview: true,
      localSyncStatus: toLocalSyncStatus(op),
    }))
    .reverse();
  return added.length === 0 ? current : [...added, ...current];
}
