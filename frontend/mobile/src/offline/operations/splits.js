import { SPLIT_PATHS } from '../../api/config';
import { buildSplitExpenseCreateRequest } from '../../utils/splitRequests';
import { computeSplitBalanceDeltas } from '../../utils/splitEdit';
import { resolveSplitExpenseCounterparts } from '../../utils/splitParticipants';
import { buildOp } from './buildOp';
import { newId } from '../ids';

/**
 * The shared-ledger targets a saved split moves — `group:{id}`, or per pair
 * `pair:{individualBalanceId}` (and `contact:{id}` for a contact pair), so a
 * later queued settlement on any of them waits for this op (ADR 0028 §7.7).
 *
 * @param {object} splitExpense
 * @returns {string[]}
 */
function ledgerTargetsOf(splitExpense) {
  if (splitExpense.splitMode === 'group') {
    return [`group:${splitExpense.groupId}`];
  }
  return resolveSplitExpenseCounterparts(splitExpense).flatMap((counterpart) =>
    [
      counterpart.individualBalanceId ? `pair:${counterpart.individualBalanceId}` : null,
      counterpart.counterpartContactId ? `contact:${counterpart.counterpartContactId}` : null,
    ].filter(Boolean),
  );
}

/**
 * The stores an edit or delete changes (ADR 0028 §7.7).
 *
 * @param {object} splitExpense
 * @returns {string[]}
 */
function affectsOf(splitExpense) {
  const affects = ['splitFeed', 'groups', 'individualBalances', 'splitExpenses'];
  if (splitExpense.personalTransactionId) {
    affects.push('transactions');
  }
  return affects;
}

/**
 * `split.update` — `PUT /split-expenses/{id}` (ADR 0028 §6, §7.7).
 *
 * `entityId` is the split id, so the op depends on that split's own pending
 * `split.create` through ADR 0027 §8.6's same-entity rule. The preview holds
 * the split before and after (the feed overlay swaps them; the transactions
 * overlay runs §5.2's follow over them) and the balance deltas
 * (new effect − old effect) the balance overlays add.
 *
 * @param {{ splitExpense: object, body: object, after: object,
 *   currentUserId: string }} input
 * @returns {object} op
 */
export function buildSplitUpdateOp({ splitExpense, body, after, currentUserId }) {
  return buildOp({
    type: 'split.update',
    entityType: 'split_expense',
    entityId: splitExpense.id,
    method: 'PUT',
    path: SPLIT_PATHS.splitExpenseById(splitExpense.id),
    body,
    referencedIds: [body.categoryId],
    ledgerTargets: ledgerTargetsOf(splitExpense),
    affects: affectsOf(splitExpense),
    preview: {
      label: body.title,
      groupId: splitExpense.splitMode === 'group' ? splitExpense.groupId : null,
      personalTransactionId: splitExpense.personalTransactionId ?? null,
      before: splitExpense,
      after,
      balanceEffects: computeSplitBalanceDeltas(splitExpense, after, currentUserId),
    },
  });
}

/**
 * `split.delete` — `DELETE /split-expenses/{id}` (ADR 0028 §2.3, §7.7). A
 * `404` on replay is "already gone" and acks (errorClassification.js).
 *
 * @param {{ splitExpense: object, currentUserId: string }} input
 * @returns {object} op
 */
export function buildSplitDeleteOp({ splitExpense, currentUserId }) {
  return buildOp({
    type: 'split.delete',
    entityType: 'split_expense',
    entityId: splitExpense.id,
    method: 'DELETE',
    path: SPLIT_PATHS.splitExpenseById(splitExpense.id),
    ledgerTargets: ledgerTargetsOf(splitExpense),
    affects: affectsOf(splitExpense),
    preview: {
      label: splitExpense.title,
      groupId: splitExpense.splitMode === 'group' ? splitExpense.groupId : null,
      personalTransactionId: splitExpense.personalTransactionId ?? null,
      deletedByUserId: currentUserId,
      before: splitExpense,
      balanceEffects: computeSplitBalanceDeltas(splitExpense, null, currentUserId),
    },
  });
}

/**
 * `split.create` — `POST /split-expenses` with `id` and, when the caller's
 * share is added to personal expenses, `personalTransactionId` (ADR 0027
 * §3.2). The body comes from the same `buildSplitExpenseCreateRequest` the
 * direct-call path uses.
 *
 * `ledgerTargets` names every shared-ledger target the split moves, so a later
 * settlement waits for it (§7.4).
 *
 * `preview.balanceEffects` carries what the overlay adds to the estimates
 * (§8.8): for a group, the caller's `paid − share`; for individual splits, one
 * `netAmount` per counterpart contact (positive = the caller owes).
 *
 * @param {{ values: object, callerPaid: number, callerShare: number,
 *   counterpartNetAmounts?: Array<{ contactId: string, netAmount: number, name?: string }>,
 *   personalRow?: object | null,
 *   categorySnapshot?: { categoryName: string, categoryGlyph: string,
 *     categoryIconName?: string | null } | null }} input
 * @returns {object} op
 */
export function buildSplitCreateOp({
  values,
  callerPaid,
  callerShare,
  counterpartNetAmounts = [],
  personalRow = null,
  categorySnapshot = null,
}) {
  const id = newId();
  const body = { ...buildSplitExpenseCreateRequest(values), id };
  const personalTransactionId = body.addToPersonalExpenses ? newId() : null;
  if (personalTransactionId) {
    body.personalTransactionId = personalTransactionId;
  }

  const isGroup = values.splitMode === 'group';
  const contactIds = isGroup ? [] : counterpartNetAmounts.map((entry) => entry.contactId);
  const ledgerTargets = isGroup
    ? [`group:${values.groupId}`]
    : contactIds.map((contactId) => `contact:${contactId}`);

  // `splitFeed`: the queued split shows in its group's or pair's feed
  // (ADR 0028 §7.7).
  const affects = isGroup
    ? ['splitExpenses', 'splitFeed', 'groups']
    : ['splitExpenses', 'splitFeed', 'individualBalances'];
  if (personalTransactionId) {
    affects.push('transactions');
  }

  return buildOp({
    type: 'split.create',
    entityType: 'split_expense',
    entityId: id,
    method: 'POST',
    path: SPLIT_PATHS.splitExpenses,
    body,
    referencedIds: [body.categoryId, values.groupId, ...contactIds],
    ledgerTargets,
    affects,
    preview: {
      label: body.title,
      groupId: isGroup ? values.groupId : null,
      categorySnapshot,
      balanceEffects: {
        groupDelta: isGroup ? callerPaid - callerShare : 0,
        counterparts: counterpartNetAmounts,
      },
      personalRow: personalRow && personalTransactionId
        ? { ...personalRow, id: personalTransactionId, splitExpenseId: id }
        : null,
    },
  });
}
