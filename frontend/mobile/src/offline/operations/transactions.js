import { TRANSACTION_PATHS } from '../../api/config';
import {
  buildTransactionCreateRequest,
  buildTransactionUpdateRequest,
} from '../../utils/transactionRequests';
import { INCOME_CATEGORY_SNAPSHOT } from '../../utils/incomeCategorySnapshot';
import { buildOp } from './buildOp';
import { newId } from '../ids';

/**
 * Transaction op builders — ADR 0027 §3.2/§8.5. The request bodies come from
 * the same `utils/transactionRequests.js` builders the direct-call path uses,
 * plus the client-supplied `id` on create (§3.1).
 *
 * `preview` carries the display fields the overlay needs to render the row
 * before the server has answered (§8.8): the category snapshot resolved from
 * the cached category by the caller, and the label for notices.
 */

/** Server constant: `categoryTone` follows `type`, never the category (ADR 0018 §3.3). */
const EXPENSE_TONE = 'neutral';

/**
 * The five category snapshot fields a row renders from, as the server will
 * freeze them (§8.8: "snapshot fields resolved from the cached category;
 * income constants for income"). Display only — never sent (ADR 0018 §3.1).
 *
 * @param {object} values Intended values; for an expense, the caller passes
 *   the selected category's `categoryName`, `parentCategoryName`,
 *   `categoryIconName` and `categoryGlyph`.
 * @returns {object}
 */
export function buildTransactionSnapshot(values) {
  if (values.type === 'income') {
    return {
      categoryName: INCOME_CATEGORY_SNAPSHOT.category,
      parentCategoryName: null,
      categoryIconName: INCOME_CATEGORY_SNAPSHOT.iconName,
      categoryGlyph: INCOME_CATEGORY_SNAPSHOT.glyph,
      categoryTone: INCOME_CATEGORY_SNAPSHOT.tone,
    };
  }
  const name = values.categoryName || 'Misc';
  return {
    categoryName: name,
    parentCategoryName: values.parentCategoryName ?? null,
    categoryIconName: values.categoryIconName ?? null,
    categoryGlyph: values.categoryGlyph || name.charAt(0).toUpperCase(),
    categoryTone: EXPENSE_TONE,
  };
}

/**
 * @param {{ values: object }} input
 * @returns {object} op
 */
export function buildTransactionCreateOp({ values }) {
  const id = newId();
  const body = { ...buildTransactionCreateRequest(values), id };
  const snapshot = {
    ...buildTransactionSnapshot(values),
    categoryId: body.categoryId ?? null,
    groupId: body.groupId ?? null,
    cashAmount: body.cashAmount ?? null,
    onlineAmount: body.onlineAmount ?? null,
    notes: body.notes ?? null,
    splitExpenseId: null,
    receiptPublicId: null,
    version: 0,
  };
  return buildOp({
    type: 'transaction.create',
    entityType: 'transaction',
    entityId: id,
    method: 'POST',
    path: TRANSACTION_PATHS.create,
    body,
    referencedIds: [body.categoryId, body.groupId],
    affects: ['transactions'],
    preview: { label: body.title, row: { ...body, ...snapshot } },
  });
}

/**
 * @param {{ current: object, values: object }} input
 * @returns {{ op: object | null, hasChanges: boolean }}
 */
export function buildTransactionUpdateOp({ current, values }) {
  const { body, hasChanges } = buildTransactionUpdateRequest(current, values);
  if (!hasChanges) {
    return { op: null, hasChanges: false };
  }
  const typeOrCategoryChanged = 'type' in body || 'categoryId' in body;
  const snapshot = typeOrCategoryChanged
    ? buildTransactionSnapshot({ ...current, ...values })
    : {};
  const op = buildOp({
    type: 'transaction.update',
    entityType: 'transaction',
    entityId: current.id,
    method: 'PATCH',
    path: TRANSACTION_PATHS.byId(current.id),
    body,
    referencedIds: [body.categoryId, body.groupId],
    affects: ['transactions'],
    preview: { label: values.title ?? current.title, patch: { ...body, ...snapshot } },
  });
  return { op, hasChanges: true };
}

/**
 * @param {{ id: string, title: string }} input
 * @returns {object} op
 */
export function buildTransactionDeleteOp({ id, title }) {
  return buildOp({
    type: 'transaction.delete',
    entityType: 'transaction',
    entityId: id,
    method: 'DELETE',
    path: TRANSACTION_PATHS.byId(id),
    affects: ['transactions'],
    preview: { label: title },
  });
}
