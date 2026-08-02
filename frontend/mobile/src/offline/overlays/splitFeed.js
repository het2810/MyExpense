import { toLocalSyncStatus } from './activeOps';

/**
 * Split feed overlay —
 * docs/decisions/0028-split-expense-edit-delete-feeds-and-balance-copy.md §7.7.
 * Pure: (one target's snapshot items, active ops) -> the items Split Detail
 * shows.
 *
 * | Op                  | Effect |
 * |---------------------|--------|
 * | `split.create`      | insert a preview split item for this target, newest first |
 * | `split.update`      | replace the embedded `splitExpense` with the op's projected one |
 * | `split.delete`      | mark the item a tombstone (`deletedAt` = the op's `clientUpdatedAt`) |
 * | `settlement.create` | insert a settlement item; payer and payee from `expectedDirection` |
 *
 * The server's items replace all of these on the next pull (ADR 0027 §8.8).
 */

/**
 * @param {object} op
 * @param {{ groupId?: string | null, individualBalanceId?: string | null,
 *   counterpartContactId?: string | null }} target
 * @returns {boolean}
 */
function createMatchesTarget(op, target) {
  if (target.groupId) {
    return op.body?.groupId === target.groupId;
  }
  if (!target.counterpartContactId) {
    return false;
  }
  const contactIds = op.body?.individualCounterpartContactIds ?? [op.body?.individualCounterpartContactId];
  return contactIds.includes(target.counterpartContactId);
}

/**
 * @param {object} op
 * @param {object} target
 * @returns {boolean}
 */
function settlementMatchesTarget(op, target) {
  const preview = op.preview ?? {};
  if (target.groupId) {
    return preview.target === 'group' && preview.groupId === target.groupId;
  }
  if (preview.target !== 'individual') {
    return false;
  }
  return (
    (Boolean(preview.individualBalanceId) && preview.individualBalanceId === target.individualBalanceId) ||
    (Boolean(preview.counterpartContactId) && preview.counterpartContactId === target.counterpartContactId)
  );
}

/**
 * A minimal split built from a queued create's body — enough for the row,
 * its viewer status and its payers line.
 *
 * @param {object} op
 * @returns {object}
 */
function previewSplitFromCreate(op) {
  const body = op.body ?? {};
  const payers = Array.isArray(body.payers)
    ? body.payers.map((payer) => ({ ...payer, name: '' }))
    : [{ payerUserId: body.paidByUserId ?? null, payerContactId: body.paidByContactId ?? null, name: '', amount: body.amount }];
  return {
    id: op.entityId,
    title: body.title,
    amount: body.amount,
    splitDate: body.splitDate,
    splitMode: body.splitMode,
    groupId: body.groupId ?? null,
    categoryId: body.categoryId ?? null,
    categoryName: op.preview?.categorySnapshot?.categoryName ?? 'Misc',
    parentCategoryName: null,
    categoryIconName: op.preview?.categorySnapshot?.categoryIconName ?? null,
    categoryGlyph: op.preview?.categorySnapshot?.categoryGlyph ?? 'M',
    categoryTone: 'neutral',
    createdByUserId: op.preview?.createdByUserId ?? null,
    createdByName: null,
    deletedAt: null,
    deletedByUserId: null,
    deletedByName: null,
    counterparts: [],
    payers,
    participants: (body.participants ?? []).map((participant) => ({ ...participant, name: '' })),
    isLocalPreview: true,
  };
}

/**
 * @param {object[]} items Snapshot items for one target, newest first.
 * @param {object[]} ops Active ops affecting `splitFeed`, queue order.
 * @param {{ groupId?: string | null, individualBalanceId?: string | null,
 *   counterpartContactId?: string | null }} target
 * @param {{ currentUserId?: string | null, currentUserName?: string }} [viewer]
 * @returns {object[]}
 */
export function overlaySplitFeed(items, ops, target, viewer = {}) {
  if (ops.length === 0) {
    return items;
  }
  const held = new Set(items.map((item) => `${item.itemType}:${item.id}`));
  let result = items;
  const inserted = [];

  ops.forEach((op) => {
    const localSyncStatus = toLocalSyncStatus(op);
    switch (op.type) {
      case 'split.create': {
        if (held.has(`split_expense:${op.entityId}`) || !createMatchesTarget(op, target)) {
          return;
        }
        inserted.push({
          itemType: 'split_expense',
          id: op.entityId,
          occurredOn: op.body?.splitDate ?? null,
          occurredAt: op.createdAt,
          splitExpense: previewSplitFromCreate(op),
          settlement: null,
          localSyncStatus,
        });
        return;
      }
      case 'split.update': {
        const after = op.preview?.after;
        if (!after) {
          return;
        }
        const replace = (item) =>
          item.itemType === 'split_expense' && item.id === op.entityId && !item.splitExpense?.deletedAt
            ? { ...item, occurredOn: after.splitDate, splitExpense: { ...after }, localSyncStatus }
            : item;
        result = result.map(replace);
        inserted.splice(0, inserted.length, ...inserted.map(replace));
        return;
      }
      case 'split.delete': {
        const tombstone = (item) =>
          item.itemType === 'split_expense' && item.id === op.entityId
            ? {
                ...item,
                splitExpense: {
                  ...item.splitExpense,
                  deletedAt: op.clientUpdatedAt,
                  deletedByUserId: op.preview?.deletedByUserId ?? viewer.currentUserId ?? null,
                  deletedByName: viewer.currentUserName ?? null,
                },
                localSyncStatus,
              }
            : item;
        result = result.map(tombstone);
        inserted.splice(0, inserted.length, ...inserted.map(tombstone));
        return;
      }
      case 'settlement.create': {
        if (held.has(`settlement:${op.entityId}`) || !settlementMatchesTarget(op, target)) {
          return;
        }
        const me = { userId: viewer.currentUserId ?? null, contactId: null, name: viewer.currentUserName ?? '' };
        const counterpart = op.preview?.counterpart ?? { userId: null, contactId: null, name: '' };
        const callerPays = op.body?.expectedDirection === 'caller_pays';
        inserted.push({
          itemType: 'settlement',
          id: op.entityId,
          occurredOn: op.preview?.occurredOn ?? op.createdAt?.slice(0, 10) ?? null,
          occurredAt: op.createdAt,
          splitExpense: null,
          settlement: {
            id: op.entityId,
            groupId: op.preview?.groupId ?? null,
            individualBalanceId: op.preview?.individualBalanceId ?? null,
            initiatedByUserId: viewer.currentUserId ?? null,
            payer: callerPays ? me : counterpart,
            payee: callerPays ? counterpart : me,
            amount: Number(op.preview?.amount ?? op.body?.amount ?? 0),
            method: op.body?.method ?? null,
            settledAt: op.createdAt,
          },
          localSyncStatus,
        });
        return;
      }
      default:
    }
  });

  return inserted.length === 0 ? result : [...inserted.reverse(), ...result];
}
