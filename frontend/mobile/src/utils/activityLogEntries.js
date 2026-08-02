/**
 * Pure builder functions for useActivityLogStore entries — docs/decisions/
 * 0008-activity-log-system.md §2. No store access, no React — mirrors
 * dateDisplay.js/currency.js's existing precedent of pure, store-agnostic
 * formatting/business logic (constitution §8). Each screen's `handleSave`
 * calls the relevant builder here, then calls
 * useActivityLogStore().addActivity/addActivities itself — the same
 * "screen orchestrates multiple store writes" pattern
 * SplitAddExpenseScreen.jsx's handleSave already uses.
 */

import { getExactDateLabel, getTodayIsoDate, getCurrentTimeString } from './dateDisplay';

const ENTRY_TYPE_LABELS = { expense: 'Debit', income: 'Credit' };
const SCOPE_LABELS = { personal: 'Personal', group: 'Group' };
const PAYMENT_MODE_LABELS = { cash: 'Cash', online: 'Online', both: 'Both' };

function formatRupees(amount) {
  return Number(amount).toLocaleString('en-IN');
}

/**
 * Event source 1 — Transaction edited (ADR 0008 §2.1). Diffs
 * `oldTransaction` against `newFields` (the exact payload the caller is
 * about to pass to updateTransaction) using the curated, explicit field
 * list — `iconName`/`glyph`/`tone`/`splitExpenseId` are never logged (they
 * are derived/implementation fields), and `time` is never logged (it is no
 * longer editable at all).
 *
 * Clustered-field skip rules: `category` is only logged when `type` did NOT
 * also change (a Debit<->Credit switch changes category as an automatic
 * side effect, not a user choice); `groupId` is only logged when `scope`
 * stayed 'group' on both sides (a Personal<->Group switch changes groupId
 * as a direct consequence); the cash/online split is only logged when
 * `paymentMode` stayed 'both' on both sides.
 *
 * @param {object} params
 * @param {string} params.transactionId
 * @param {object} params.oldTransaction - the full record before the edit
 * @param {object} params.newFields - the exact payload passed to updateTransaction
 * @param {Array} params.groups - useGroupsStore().groups, for resolving a changed groupId to a name
 * @returns {object[]} zero or more activity entries, one per meaningfully changed field
 */
export function buildTransactionEditActivities({ transactionId, oldTransaction, newFields, groups }) {
  const descriptions = [];

  if (oldTransaction.title !== newFields.title) {
    descriptions.push(`Name changed from "${oldTransaction.title}" to "${newFields.title}".`);
  }

  if (oldTransaction.amount !== newFields.amount) {
    descriptions.push(
      `Amount changed from ₹${formatRupees(oldTransaction.amount)} to ₹${formatRupees(newFields.amount)}.`,
    );
  }

  const typeChanged = oldTransaction.type !== newFields.type;
  if (typeChanged) {
    descriptions.push(
      `Entry type changed from ${ENTRY_TYPE_LABELS[oldTransaction.type]} to ${ENTRY_TYPE_LABELS[newFields.type]}.`,
    );
  }

  // Only log category when type itself did NOT change (clustered-field rule).
  if (!typeChanged && oldTransaction.category !== newFields.category) {
    descriptions.push(`Category changed from ${oldTransaction.category} to ${newFields.category}.`);
  }

  if (oldTransaction.date !== newFields.date) {
    descriptions.push(
      `Date changed from ${getExactDateLabel(oldTransaction.date)} to ${getExactDateLabel(newFields.date)}.`,
    );
  }

  const scopeChanged = oldTransaction.scope !== newFields.scope;
  if (scopeChanged) {
    descriptions.push(
      `Type changed from ${SCOPE_LABELS[oldTransaction.scope]} to ${SCOPE_LABELS[newFields.scope]}.`,
    );
  }

  // Only log groupId when scope stayed 'group' on both sides (clustered-field rule).
  if (
    !scopeChanged &&
    oldTransaction.scope === 'group' &&
    newFields.scope === 'group' &&
    oldTransaction.groupId !== newFields.groupId
  ) {
    const oldGroupName = groups.find((group) => group.id === oldTransaction.groupId)?.name ?? 'a group';
    const newGroupName = groups.find((group) => group.id === newFields.groupId)?.name ?? 'a group';
    descriptions.push(`Group changed from ${oldGroupName} to ${newGroupName}.`);
  }

  const paymentModeChanged = oldTransaction.paymentMode !== newFields.paymentMode;
  if (paymentModeChanged) {
    descriptions.push(
      `Payment mode changed from ${PAYMENT_MODE_LABELS[oldTransaction.paymentMode]} to ${PAYMENT_MODE_LABELS[newFields.paymentMode]}.`,
    );
  }

  // Only log the cash/online split when paymentMode stayed 'both' on both sides.
  if (
    !paymentModeChanged &&
    oldTransaction.paymentMode === 'both' &&
    newFields.paymentMode === 'both' &&
    (oldTransaction.cashAmount !== newFields.cashAmount ||
      oldTransaction.onlineAmount !== newFields.onlineAmount)
  ) {
    descriptions.push(
      `Cash/Online split changed from ₹${formatRupees(oldTransaction.cashAmount)} cash / ₹${formatRupees(oldTransaction.onlineAmount)} online to ₹${formatRupees(newFields.cashAmount)} cash / ₹${formatRupees(newFields.onlineAmount)} online.`,
    );
  }

  // Notes/Receipt — presence-based copy, not full before/after text (avoids
  // dumping arbitrarily long free text, or a meaningless uri, into the log).
  if (oldTransaction.notes !== newFields.notes) {
    if (!oldTransaction.notes && newFields.notes) {
      descriptions.push('Notes added.');
    } else if (oldTransaction.notes && !newFields.notes) {
      descriptions.push('Notes removed.');
    } else {
      descriptions.push('Notes updated.');
    }
  }

  if (oldTransaction.receiptUri !== newFields.receiptUri) {
    if (!oldTransaction.receiptUri && newFields.receiptUri) {
      descriptions.push('Receipt photo added.');
    } else if (oldTransaction.receiptUri && !newFields.receiptUri) {
      descriptions.push('Receipt photo removed.');
    } else {
      descriptions.push('Receipt photo replaced.');
    }
  }

  const date = getTodayIsoDate();
  const time = getCurrentTimeString();
  const batchTimestamp = Date.now();

  // Id collision guard (ADR 0008 §2.1) — Date.now() alone isn't guaranteed
  // unique across every entry minted within the same synchronous Save call.
  return descriptions.map((descriptionPrefix, index) => ({
    id: `activity-${batchTimestamp}-${index}`,
    type: 'transaction_edited',
    date,
    time,
    descriptionPrefix,
    entityName: null,
    descriptionSuffix: '',
    relatedTransactionId: transactionId,
    relatedGroupId: null,
    relatedContactId: null,
    relatedSplitExpenseId: null,
    iconName: 'create-outline',
    glyph: '✎',
    tone: 'neutral',
  }));
}

/**
 * Event source 2 — Split expense saved (ADR 0008 §2.2). Exactly four cases
 * — Individual/Group x You-paid/They-paid — each with its own template.
 * `amount` is the total split amount (splitExpense.amount), not the user's
 * own consumption share.
 *
 * @param {object} params
 * @param {string} params.title
 * @param {number} params.amount - total split amount
 * @param {'individual'|'group'} params.splitMode
 * @param {string} params.paidById - 'self', or a participantId
 * @param {Array} params.participants - [{ participantId, name, ... }], "you" first
 * @param {object|null} params.selectedGroup - Group mode only
 * @param {string|null} params.transactionId - the just-created personal transaction id, or null
 * @param {string} params.splitExpenseId
 * @returns {object} one activity entry
 */
export function buildSplitSavedActivity({
  title,
  amount,
  splitMode,
  paidById,
  participants,
  selectedGroup,
  transactionId,
  splitExpenseId,
}) {
  const formattedAmount = formatRupees(amount);
  const isIndividual = splitMode === 'individual';

  let descriptionPrefix;
  let entityName;
  let descriptionSuffix;
  let relatedContactId = null;
  let relatedGroupId = null;

  if (isIndividual) {
    const other = participants.find((participant) => participant.participantId !== 'self');
    entityName = other?.name ?? '';
    relatedContactId = other?.participantId ?? null;

    if (paidById === 'self') {
      descriptionPrefix = `You paid ₹${formattedAmount} to `;
      descriptionSuffix = ` for "${title}".`;
    } else {
      descriptionPrefix = '';
      descriptionSuffix = ` paid ₹${formattedAmount} to you for "${title}".`;
    }
  } else {
    entityName = selectedGroup?.name ?? '';
    relatedGroupId = selectedGroup?.id ?? null;
    descriptionSuffix = ` for "${title}".`;

    if (paidById === 'self') {
      descriptionPrefix = `You paid ₹${formattedAmount} in `;
    } else {
      const payer = participants.find((participant) => participant.participantId === paidById);
      descriptionPrefix = `${payer?.name ?? 'Someone'} paid ₹${formattedAmount} in `;
    }
  }

  return {
    id: `activity-${Date.now()}`,
    type: 'split_saved',
    date: getTodayIsoDate(),
    time: getCurrentTimeString(),
    descriptionPrefix,
    entityName,
    descriptionSuffix,
    relatedTransactionId: transactionId,
    relatedGroupId,
    relatedContactId,
    relatedSplitExpenseId: splitExpenseId,
    iconName: 'swap-horizontal-outline',
    glyph: '⇄',
    tone: 'accent',
  };
}

/**
 * Event source 3 — Group created (ADR 0008 §2.3). `memberCount` reuses
 * SplitGroupsListScreen.jsx's own existing derivation exactly
 * (`group.memberContactIds.length + 1` — the +1 accounts for the creator,
 * implicitly a member but not stored in memberContactIds).
 *
 * @param {object} params
 * @param {object} params.group - the newly created group record
 * @param {number} params.memberCount
 * @returns {object} one activity entry
 */
export function buildGroupCreatedActivity({ group, memberCount }) {
  return {
    id: `activity-${Date.now()}`,
    type: 'group_created',
    date: getTodayIsoDate(),
    time: getCurrentTimeString(),
    descriptionPrefix: 'You created the group "',
    entityName: group.name,
    descriptionSuffix: `" with ${memberCount} members.`,
    relatedTransactionId: null,
    relatedGroupId: group.id,
    relatedContactId: null,
    relatedSplitExpenseId: null,
    iconName: 'people-outline',
    glyph: 'G',
    tone: 'success',
  };
}

/**
 * Event source 4 — Settle Up (ADR 0009 §6.3). `amount` is the absolute
 * value of the aggregate yourBalance immediately BEFORE it was zeroed —
 * captured by the caller before calling settleBalance, since settleBalance
 * itself discards the prior value. Direction (owed vs. owing) is
 * deliberately not encoded in the copy — matches the task's own example
 * copy, which states only that settlement occurred and the amount involved.
 *
 * `method` (optional, `'upi' | 'marked_paid'`, added by ADR 0009's
 * 2026-08-14 amendment, Part D — the dedicated SettleUp screen's
 * "Mark as Paid"/"Settle via UPI / External App" selection) — default
 * `'marked_paid'` preserves this function's exact original copy for any
 * caller that doesn't pass it, so this is a backward-compatible addition,
 * not a breaking change. Both options fire the identical settle mechanism;
 * only the logged copy differs — a cheap, honest record of which option the
 * user picked, without fabricating any real payment integration.
 *
 * @param {object} params
 * @param {'group'|'individual'} params.mode
 * @param {string} params.name - group.name, or the individual entry's personName
 * @param {number} params.amount - Math.abs(yourBalance) before settling
 * @param {string|null} params.groupId - Group mode only
 * @param {string|null} params.contactId - Individual mode only (the underlying contact id, not the individualSplits entry id — mirrors relatedContactId's existing convention elsewhere in this file)
 * @param {'upi'|'marked_paid'} [params.method] - defaults to 'marked_paid'
 * @returns {object} one activity entry
 */
export function buildSettlementActivity({ mode, name, amount, groupId, contactId, method = 'marked_paid' }) {
  const isGroup = mode === 'group';
  const descriptionSuffix =
    method === 'upi' ? ` via UPI — ₹${formatRupees(amount)}.` : ` — ₹${formatRupees(amount)}.`;

  return {
    id: `activity-${Date.now()}`,
    type: 'settlement',
    date: getTodayIsoDate(),
    time: getCurrentTimeString(),
    descriptionPrefix: isGroup ? 'You settled up in ' : 'You settled up with ',
    entityName: name,
    descriptionSuffix,
    relatedTransactionId: null,
    relatedGroupId: isGroup ? groupId : null,
    relatedContactId: isGroup ? null : contactId,
    relatedSplitExpenseId: null,
    iconName: 'swap-horizontal-outline',
    glyph: '⇄',
    tone: 'accent',
  };
}
