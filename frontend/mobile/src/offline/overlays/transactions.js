import { applySplitEditToPersonalTransaction } from '../../utils/splitEdit';
import { toLocalSyncStatus } from './activeOps';

/**
 * Transactions overlay — ADR 0027 §8.8. Pure: (snapshot rows, active ops) ->
 * the rows screens show.
 *
 * | Op                   | Effect |
 * |----------------------|--------|
 * | `transaction.create` | insert the preview row (skipped if the snapshot already holds the id), newest first |
 * | `transaction.update` | patch the row with the body + re-derived snapshot fields |
 * | `transaction.delete` | remove the row |
 * | `split.create`       | insert the caller's consumption-share row when `addToPersonalExpenses` |
 * | `split.update`       | the linked row follows the edit field by field (ADR 0028 §5.2) |
 * | `split.delete`       | remove the linked row (ADR 0028 §5.3) |
 * | `category.update`    | rename the snapshot on rows in that category |
 * | `category.delete`    | move rows in that category to the cached protected category |
 *
 * Own-data totals (Dashboard spent/remaining) include these rows and are not
 * labelled estimates (§8.8).
 */

/**
 * Newest first by `txnDate`, then `txnTime` — the server's own order keys.
 *
 * @param {object} left
 * @param {object} right
 * @returns {number}
 */
function compareNewestFirst(left, right) {
  const byDate = String(right.txnDate).localeCompare(String(left.txnDate));
  if (byDate !== 0) {
    return byDate;
  }
  return String(right.txnTime ?? '').localeCompare(String(left.txnTime ?? ''));
}

/**
 * @param {object[]} rows
 * @param {object} row
 * @returns {object[]}
 */
function insertSorted(rows, row) {
  const position = rows.findIndex((existing) => compareNewestFirst(row, existing) <= 0);
  if (position === -1) {
    return [...rows, row];
  }
  return [...rows.slice(0, position), row, ...rows.slice(position)];
}

/**
 * @param {object[]} rows Snapshot rows, newest first.
 * @param {object[]} ops Active ops affecting `transactions`, queue order.
 * @returns {object[]}
 */
export function overlayTransactions(rows, ops) {
  if (ops.length === 0) {
    return rows;
  }
  const snapshotIds = new Set(rows.map((row) => row.id));
  let result = rows;

  ops.forEach((op) => {
    const status = toLocalSyncStatus(op);
    switch (op.type) {
      case 'transaction.create': {
        if (snapshotIds.has(op.entityId) || !op.preview?.row) {
          return;
        }
        result = insertSorted(result, { ...op.preview.row, localSyncStatus: status });
        return;
      }
      case 'split.create': {
        const personalRow = op.preview?.personalRow;
        if (!personalRow || snapshotIds.has(personalRow.id)) {
          return;
        }
        result = insertSorted(result, { ...personalRow, localSyncStatus: status });
        return;
      }
      case 'split.update': {
        // ADR 0028 §5.2/§7.7: the linked personal transaction follows the
        // edit field by field, through the same pure helper the rest of the
        // app uses; a share that drops to zero hides it.
        const transactionId = op.preview?.personalTransactionId;
        if (!transactionId || !op.preview?.before || !op.preview?.after) {
          return;
        }
        result = result.flatMap((row) => {
          if (row.id !== transactionId) {
            return [row];
          }
          const { transaction, isRemoved } = applySplitEditToPersonalTransaction(
            row,
            op.preview.before,
            op.preview.after,
          );
          return isRemoved ? [] : [{ ...transaction, localSyncStatus: status ?? row.localSyncStatus ?? null }];
        });
        return;
      }
      case 'split.delete': {
        // ADR 0028 §5.3: the live personal transaction goes with the split.
        const transactionId = op.preview?.personalTransactionId;
        if (transactionId) {
          result = result.filter((row) => row.id !== transactionId);
        }
        return;
      }
      case 'transaction.update': {
        result = result.map((row) =>
          row.id === op.entityId
            ? { ...row, ...(op.preview?.patch || op.body), localSyncStatus: status ?? row.localSyncStatus ?? null }
            : row,
        );
        return;
      }
      case 'transaction.delete': {
        result = result.filter((row) => row.id !== op.entityId);
        return;
      }
      case 'category.update': {
        const newName = op.body?.name;
        if (!newName) {
          return;
        }
        result = result.map((row) => {
          if (row.categoryId === op.entityId) {
            return { ...row, categoryName: newName };
          }
          return row;
        });
        return;
      }
      case 'category.delete': {
        const misc = op.preview?.miscCategory;
        if (!misc) {
          return;
        }
        result = result.map((row) =>
          row.categoryId === op.entityId
            ? {
                ...row,
                categoryId: misc.id,
                categoryName: misc.name,
                parentCategoryName: null,
                categoryIconName: misc.iconName ?? row.categoryIconName,
                categoryGlyph: misc.glyph ?? row.categoryGlyph,
              }
            : row,
        );
        return;
      }
      default:
    }
  });

  return result;
}
