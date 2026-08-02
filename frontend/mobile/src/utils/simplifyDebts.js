/**
 * Group debt simplification —
 * docs/decisions/0028-split-expense-edit-delete-feeds-and-balance-copy.md §8.2.
 *
 * **Client only, and deterministic.** Every member's device runs this same
 * function over the same server balances, so they all show the same list.
 * Integer paise throughout (exact for `numeric(12,2)`), and every tie is broken
 * by the smaller member key, compared as plain strings: lowercase uuid text
 * order equals PostgreSQL's uuid order on every platform.
 *
 * Pure JS, no React Native import (ADR 0028 §14).
 */

/**
 * The member key §8.2 orders by: `'u:' + userId` or `'c:' + invitedContactId`,
 * lowercase canonical uuid text.
 *
 * @param {{ userId?: string | null, invitedContactId?: string | null }} member
 * @returns {string | null}
 */
export function toMemberKey(member) {
  if (member?.userId) {
    return `u:${String(member.userId).toLowerCase()}`;
  }
  if (member?.invitedContactId) {
    return `c:${String(member.invitedContactId).toLowerCase()}`;
  }
  return null;
}

/**
 * @param {string} left
 * @param {string} right
 * @returns {number}
 */
function compareKeys(left, right) {
  if (left < right) {
    return -1;
  }
  return left > right ? 1 : 0;
}

/**
 * The entry with the largest |paise|; ties go to the smallest key.
 *
 * @param {Array<{ key: string, paise: number }>} entries Non-empty.
 * @returns {{ key: string, paise: number }}
 */
function pickLargest(entries) {
  return entries.reduce((best, entry) => {
    const bestSize = Math.abs(best.paise);
    const entrySize = Math.abs(entry.paise);
    if (entrySize > bestSize) {
      return entry;
    }
    if (entrySize === bestSize && compareKeys(entry.key, best.key) < 0) {
      return entry;
    }
    return best;
  });
}

/**
 * One group's members (viewer first) and simplified debts, with each debt's
 * `from`/`to` member attached — shared by the Balances tab
 * (`hooks/useGroupBalancesView.js`) and the Split tab's group cards (§9.2).
 *
 * `hasBalances` is false when the server predates §8.1 (no
 * `members[].balance`); no debts are computed then.
 *
 * @param {object | null} group GroupResponse (possibly overlaid).
 * @param {string | null} currentUserId
 * @returns {{ members: object[], debts: object[], viewerDebts: object[],
 *   hasBalances: boolean, error: 'unbalanced' | null }}
 */
export function describeGroupDebts(group, currentUserId) {
  const viewerKey = toMemberKey({ userId: currentUserId });
  const members = (group?.members ?? [])
    .map((member) => ({
      ...member,
      key: toMemberKey(member),
      isMe: Boolean(currentUserId) && member.userId === currentUserId,
    }))
    .filter((member) => member.key)
    .sort((left, right) => Number(right.isMe) - Number(left.isMe));

  const hasBalances = members.length > 0 && members.every((member) => Number.isFinite(member.balance));
  if (!hasBalances) {
    return { members, debts: [], viewerDebts: [], hasBalances, error: null };
  }
  const byKey = new Map(members.map((member) => [member.key, member]));
  const result = simplifyDebts(members);
  const debts = result.debts.map((debt) => ({
    ...debt,
    from: byKey.get(debt.fromKey),
    to: byKey.get(debt.toKey),
  }));
  const viewerDebts = debts.filter((debt) => debt.fromKey === viewerKey || debt.toKey === viewerKey);
  return { members, debts, viewerDebts, hasBalances, error: result.error };
}

/**
 * @param {Array<{ key: string, name?: string, balance: number }>} members
 *   `balance` positive = owed, negative = owes (GroupResponse.members[].balance).
 * @returns {{ debts: Array<{ fromKey: string, toKey: string, amountPaise: number,
 *   amount: number }>, error: 'unbalanced' | null }}
 */
export function simplifyDebts(members) {
  const entries = (Array.isArray(members) ? members : [])
    .filter((member) => member && typeof member.key === 'string')
    .map((member) => ({ key: member.key, paise: Math.round(Number(member.balance) * 100) }));

  if (entries.some((entry) => !Number.isFinite(entry.paise))) {
    return { debts: [], error: 'unbalanced' };
  }
  const total = entries.reduce((sum, entry) => sum + entry.paise, 0);
  if (total !== 0) {
    return { debts: [], error: 'unbalanced' };
  }

  let creditors = entries.filter((entry) => entry.paise > 0);
  let debtors = entries.filter((entry) => entry.paise < 0);
  const debts = [];

  while (creditors.length > 0 && debtors.length > 0) {
    const creditor = pickLargest(creditors);
    const debtor = pickLargest(debtors);
    const transfer = Math.min(creditor.paise, Math.abs(debtor.paise));
    debts.push({
      fromKey: debtor.key,
      toKey: creditor.key,
      amountPaise: transfer,
      amount: transfer / 100,
    });
    creditor.paise -= transfer;
    debtor.paise += transfer;
    creditors = creditors.filter((entry) => entry.paise !== 0);
    debtors = debtors.filter((entry) => entry.paise !== 0);
  }

  return { debts, error: null };
}
