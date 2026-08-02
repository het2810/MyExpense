import { toPaise } from '../../utils/currency';
import { toMemberKey } from '../../utils/simplifyDebts';
import { computeSplitBalanceDeltas } from '../../utils/splitEdit';
import { isWaiting } from './activeOps';

/**
 * Paise-exact rounding through the shared primitive (constitution §25), so a
 * chain of estimates never accumulates float drift.
 *
 * @param {number} value
 * @returns {number}
 */
function roundToPaise(value) {
  return toPaise(value) / 100;
}

/**
 * Balance estimates — ADR 0027 §8.8.
 *
 * - **Group:** `yourBalance += (caller paid − caller share)` per queued split;
 *   a queued settlement moves the caller's balance toward zero by its amount.
 * - **Individual:** each counterpart's pair `balance += −netAmount` (the §9.3
 *   convention: `netAmount` positive = the caller owes). A pair with no
 *   snapshot row appears as a new estimated row keyed by its contact.
 *
 * Every value that includes at least one active op carries
 * `isEstimate: true` and `pendingOpCount` (ops not yet sent). The UI renders
 * "≈" and "Estimated · {n} change(s) waiting to sync". The server
 * recomputes everything on replay; these numbers are never sent (§7.1).
 *
 * Pure.
 */

const SPLIT_OP_TYPES = new Set(['split.create', 'split.update', 'split.delete']);
const GROUP_LEDGER_OP_TYPES = new Set([...SPLIT_OP_TYPES, 'settlement.create']);

/**
 * @param {number} balance
 * @param {number} amount Positive settlement amount.
 * @returns {number}
 */
function moveTowardZero(balance, amount) {
  if (balance > 0) {
    return Math.max(0, balance - amount);
  }
  if (balance < 0) {
    return Math.min(0, balance + amount);
  }
  return 0;
}

/**
 * @param {object} row
 * @param {object} op
 * @returns {object}
 */
function markEstimate(row, op) {
  return {
    ...row,
    isEstimate: true,
    pendingOpCount: (row.pendingOpCount ?? 0) + (isWaiting(op) ? 1 : 0),
  };
}

/**
 * @param {object[]} groups Groups (already list-overlaid).
 * @param {object[]} ops Active ops affecting `groups`, queue order.
 * @returns {object[]}
 */
export function overlayGroupBalances(groups, ops, currentUserId = null) {
  const ledgerOps = ops.filter((op) => GROUP_LEDGER_OP_TYPES.has(op.type));
  if (ledgerOps.length === 0) {
    return groups;
  }
  return groups.map((group) => {
    let row = group;
    ledgerOps.forEach((op) => {
      if (SPLIT_OP_TYPES.has(op.type) && op.preview?.groupId === group.id) {
        // split.create / split.update / split.delete (ADR 0028 §7.7): the
        // viewer's own figure, then every member's (§8.1) so the Balances tab
        // and its suggested payments stay zero-sum while the op waits.
        const delta = Number(op.preview.balanceEffects?.groupDelta ?? 0);
        row = markEstimate(
          {
            ...row,
            yourBalance: roundToPaise(row.yourBalance + delta),
            members: applyMemberDeltas(row.members, memberDeltasForSplitOp(op, currentUserId)),
          },
          op,
        );
      }
      if (
        op.type === 'settlement.create' &&
        op.preview?.target === 'group' &&
        op.preview.groupId === group.id
      ) {
        const amount = Number(op.preview.amount);
        row = markEstimate(
          {
            ...row,
            yourBalance: roundToPaise(moveTowardZero(row.yourBalance, amount)),
            members: applyMemberDeltas(row.members, memberDeltasForSettlement(op, currentUserId, amount)),
          },
          op,
        );
      }
    });
    return row;
  });
}

/**
 * Per-member deltas of a queued group split op, keyed by §8.2 member key. An
 * edit or delete carries them in its preview; a create's are derived from its
 * body (`paid − share` per identity).
 *
 * @param {object} op
 * @param {string | null} currentUserId
 * @returns {Record<string, number>}
 */
function memberDeltasForSplitOp(op, currentUserId) {
  if (op.preview?.balanceEffects?.memberDeltas) {
    return op.preview.balanceEffects.memberDeltas;
  }
  if (op.type !== 'split.create' || !op.body) {
    return {};
  }
  const body = op.body;
  const created = {
    splitMode: 'group',
    amount: body.amount,
    payers: Array.isArray(body.payers)
      ? body.payers
      : [{ payerUserId: body.paidByUserId ?? null, payerContactId: body.paidByContactId ?? null, amount: body.amount }],
    participants: body.participants ?? [],
  };
  const empty = { splitMode: 'group', payers: [], participants: [] };
  return computeSplitBalanceDeltas(empty, created, currentUserId).memberDeltas;
}

/**
 * A group settlement moves the viewer and the counterpart in opposite
 * directions by its amount (ADR 0023 §4).
 *
 * @param {object} op
 * @param {string | null} currentUserId
 * @param {number} amount
 * @returns {Record<string, number>}
 */
function memberDeltasForSettlement(op, currentUserId, amount) {
  const viewerKey = toMemberKey({ userId: currentUserId });
  const counterpartKey = toMemberKey({
    userId: op.preview?.counterpart?.userId ?? op.body?.counterpartUserId,
    invitedContactId: op.preview?.counterpart?.contactId ?? op.body?.counterpartContactId,
  });
  if (!viewerKey || !counterpartKey) {
    return {};
  }
  const viewerDelta = op.body?.expectedDirection === 'caller_pays' ? amount : -amount;
  return { [viewerKey]: viewerDelta, [counterpartKey]: -viewerDelta };
}

/**
 * @param {object[] | undefined} members
 * @param {Record<string, number>} deltas
 * @returns {object[] | undefined}
 */
function applyMemberDeltas(members, deltas) {
  if (!Array.isArray(members) || Object.keys(deltas).length === 0) {
    return members;
  }
  return members.map((member) => {
    const delta = deltas[toMemberKey(member)];
    if (!delta || !Number.isFinite(member.balance)) {
      return member;
    }
    return { ...member, balance: roundToPaise(member.balance + delta) };
  });
}

/**
 * @param {object[]} balances Snapshot pair rows.
 * @param {object[]} ops Active ops affecting `individualBalances`, queue order.
 * @returns {object[]}
 */
export function overlayIndividualBalances(balances, ops) {
  const ledgerOps = ops.filter((op) => GROUP_LEDGER_OP_TYPES.has(op.type));
  if (ledgerOps.length === 0) {
    return balances;
  }

  let rows = balances;
  const findIndexForContact = (contactId) =>
    rows.findIndex((row) => row.counterpartContactId === contactId);

  ledgerOps.forEach((op) => {
    if (op.type === 'split.update' || op.type === 'split.delete') {
      // ADR 0028 §7.7: (new effect − old effect) per pair row, caller-oriented
      // like `balance` itself, computed when the op was built.
      (op.preview?.balanceEffects?.pairDeltas ?? []).forEach((entry) => {
        rows = rows.map((row) =>
          row.id === entry.individualBalanceId
            ? markEstimate({ ...row, balance: roundToPaise(row.balance + Number(entry.delta)) }, op)
            : row,
        );
      });
      return;
    }
    if (op.type === 'split.create') {
      (op.preview?.balanceEffects?.counterparts ?? []).forEach((entry) => {
        const index = findIndexForContact(entry.contactId);
        const delta = -Number(entry.netAmount);
        if (index === -1) {
          rows = [
            ...rows,
            markEstimate(
              {
                id: `pending-contact:${entry.contactId}`,
                counterpartUserId: null,
                counterpartContactId: entry.contactId,
                counterpartName: entry.name ?? '',
                balance: roundToPaise(delta),
                updatedAt: null,
              },
              op,
            ),
          ];
          return;
        }
        rows = rows.map((row, position) =>
          position === index
            ? markEstimate({ ...row, balance: roundToPaise(row.balance + delta) }, op)
            : row,
        );
      });
      return;
    }

    if (op.type === 'settlement.create' && op.preview?.target === 'individual') {
      const index = op.preview.individualBalanceId
        ? rows.findIndex((row) => row.id === op.preview.individualBalanceId)
        : findIndexForContact(op.preview.counterpartContactId);
      if (index === -1) {
        return;
      }
      rows = rows.map((row, position) =>
        position === index
          ? markEstimate(
              { ...row, balance: roundToPaise(moveTowardZero(row.balance, Number(op.preview.amount))) },
              op,
            )
          : row,
      );
    }
  });

  return rows;
}
