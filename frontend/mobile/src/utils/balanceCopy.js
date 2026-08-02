import { formatSplitAmount } from './currency';
import { shortName } from './personName';
import { describeGroupDebts } from './simplifyDebts';
import { findPairEffect, joinPayerLabels, resolveSplitExpensePayers } from './splitParticipants';

/**
 * Every client-side "who owes whom" sentence —
 * docs/decisions/0028-split-expense-edit-delete-feeds-and-balance-copy.md §9.1.
 * Screens never compose these inline.
 *
 * Conventions:
 * - the viewer is always `You`/`you`; everyone else is `shortName(name)`;
 * - `symbol` is the user's display symbol (ADR 0017), `₹` by default, and the
 *   number is the split flow's `en-IN` formatting (`formatSplitAmount`);
 * - a party is `{ userId?, key?, name }` where `key` is a §8.2 member key
 *   (`u:{userId}` / `c:{contactId}`); `me` is the signed-in user's id.
 *
 * Pure JS, no React Native import (§14).
 */

const DEFAULT_SYMBOL = '₹';

/**
 * @param {number} amount
 * @param {string} symbol
 * @returns {string} e.g. '₹1,443.4'
 */
export function formatMoney(amount, symbol = DEFAULT_SYMBOL) {
  return `${symbol}${formatSplitAmount(Math.abs(Number(amount) || 0))}`;
}

/**
 * @param {{ userId?: string | null, key?: string | null } | null | undefined} party
 * @param {string | null | undefined} me
 * @returns {boolean}
 */
export function isViewer(party, me) {
  if (!party || !me) {
    return false;
  }
  return party.userId === me || party.key === `u:${String(me).toLowerCase()}`;
}

/**
 * One simplified debt (§8.2).
 *
 * @returns {string} `You owe {to} ₹X` · `{from} owes you ₹X` · `{from} owes {to} ₹X`
 */
export function debtSentence(from, to, amount, me, symbol = DEFAULT_SYMBOL) {
  const money = formatMoney(amount, symbol);
  if (isViewer(from, me)) {
    return `You owe ${shortName(to?.name)} ${money}`;
  }
  if (isViewer(to, me)) {
    return `${shortName(from?.name)} owes you ${money}`;
  }
  return `${shortName(from?.name)} owes ${shortName(to?.name)} ${money}`;
}

/**
 * One member's net in a group (Balances tab).
 *
 * @param {{ userId?: string | null, key?: string | null, name: string, balance: number }} member
 * @returns {string}
 */
export function memberNetSentence(member, me, symbol = DEFAULT_SYMBOL) {
  const isMe = isViewer(member, me);
  const name = shortName(member?.name);
  const balance = Number(member?.balance) || 0;
  if (balance > 0) {
    return isMe
      ? `You get back ${formatMoney(balance, symbol)}`
      : `${name} gets back ${formatMoney(balance, symbol)}`;
  }
  if (balance < 0) {
    return isMe ? `You owe ${formatMoney(balance, symbol)}` : `${name} owes ${formatMoney(balance, symbol)}`;
  }
  return isMe ? "You're settled up" : `${name} is settled up`;
}

/**
 * One pair, from `IndividualBalanceResponse` (already caller-oriented).
 *
 * @param {string} name counterpartName
 * @param {number} balance
 * @returns {string}
 */
export function pairBalanceSentence(name, balance, symbol = DEFAULT_SYMBOL) {
  const short = shortName(name);
  if (balance > 0) {
    return `${short} owes you ${formatMoney(balance, symbol)}`;
  }
  if (balance < 0) {
    return `You owe ${short} ${formatMoney(balance, symbol)}`;
  }
  return `You and ${short} are settled up`;
}

/**
 * @param {number} yourBalance GroupResponse.yourBalance
 * @returns {string}
 */
export function groupSummarySentence(yourBalance, symbol = DEFAULT_SYMBOL) {
  if (yourBalance > 0) {
    return `You are owed ${formatMoney(yourBalance, symbol)} overall`;
  }
  if (yourBalance < 0) {
    return `You owe ${formatMoney(yourBalance, symbol)} overall`;
  }
  return "You're all settled up in this group";
}

/**
 * The right-hand status of a feed row (§7.8).
 *
 * @param {string} status
 * @param {number | null} amount
 * @returns {string}
 */
export function feedStatusText(status, amount, symbol = DEFAULT_SYMBOL) {
  switch (status) {
    case 'lent':
      return `you lent ${formatMoney(amount, symbol)}`;
    case 'borrowed':
      return `you borrowed ${formatMoney(amount, symbol)}`;
    case 'owed':
      return `you're owed ${formatMoney(amount, symbol)}`;
    case 'owe':
      return `you owe ${formatMoney(amount, symbol)}`;
    case 'paid':
      return `you paid ${formatMoney(amount, symbol)}`;
    case 'received':
      return `you received ${formatMoney(amount, symbol)}`;
    case 'no_balance':
      return 'no balance';
    case 'deleted':
      return 'deleted';
    case 'recorded':
      return `recorded ${formatMoney(amount, symbol)}`;
    default:
      return 'not involved';
  }
}

/**
 * The design-system tone of a feed status (§9.1).
 *
 * @param {string} status
 * @returns {'positive' | 'negative' | 'neutral' | 'muted'}
 */
export function feedStatusTone(status) {
  switch (status) {
    case 'lent':
    case 'owed':
    case 'received':
      return 'positive';
    case 'borrowed':
    case 'owe':
      return 'negative';
    case 'paid':
      return 'neutral';
    default:
      return 'muted';
  }
}

/**
 * @param {{ userId?: string | null, name: string }} payer
 * @param {{ userId?: string | null, name: string }} payee
 * @returns {string} `You paid {payee} ₹X` · `{payer} paid you ₹X` · `{payer} paid {payee} ₹X`
 */
export function settlementTitle(payer, payee, amount, me, symbol = DEFAULT_SYMBOL) {
  const money = formatMoney(amount, symbol);
  if (isViewer(payer, me)) {
    return `You paid ${shortName(payee?.name)} ${money}`;
  }
  if (isViewer(payee, me)) {
    return `${shortName(payer?.name)} paid you ${money}`;
  }
  return `${shortName(payer?.name)} paid ${shortName(payee?.name)} ${money}`;
}

/**
 * A settlement written before ADR 0028 has no direction (§7.4).
 *
 * @param {{ userId?: string | null, name?: string }} initiator
 * @returns {string}
 */
export function legacySettlementTitle(initiator, amount, me, symbol = DEFAULT_SYMBOL) {
  const money = formatMoney(amount, symbol);
  return isViewer(initiator, me)
    ? `You recorded a ${money} payment`
    : `${shortName(initiator?.name)} recorded a ${money} payment`;
}

/**
 * A split row's subtitle: the viewer first as `You`, then every other payer in
 * response order, joined by ADR 0025 §6.1's joiner.
 *
 * @param {object} splitExpense
 * @returns {string} e.g. `You and Raj M. paid ₹900`
 */
export function payersLine(splitExpense, me, symbol = DEFAULT_SYMBOL) {
  const payers = resolveSplitExpensePayers(splitExpense);
  const viewerPaid = Boolean(me) && payers.some((payer) => payer.payerUserId === me);
  const others = payers
    .filter((payer) => !(me && payer.payerUserId === me))
    .map((payer) => shortName(payer.name));
  const labels = viewerPaid ? ['You', ...others] : others;
  const who = labels.length > 0 ? joinPayerLabels(labels) : 'Someone';
  return `${who} paid ${formatMoney(splitExpense?.amount, symbol)}`;
}

/**
 * @param {object} splitExpense A tombstone.
 * @returns {string} `Deleted by you` · `Deleted by {name}`
 */
export function tombstoneLine(splitExpense, me) {
  if (me && splitExpense?.deletedByUserId === me) {
    return 'Deleted by you';
  }
  return `Deleted by ${shortName(splitExpense?.deletedByName)}`;
}

/**
 * Split Expense Detail's explanation of ADR 0026 routing, for an individual
 * split with 2+ counterparts or when the viewer is a counterpart. `null` when
 * it does not apply.
 *
 * @param {object} splitExpense
 * @param {{ individualBalanceId?: string | null } | null} target
 * @returns {string | null}
 */
export function routingNote(splitExpense, target, me, symbol = DEFAULT_SYMBOL) {
  if (splitExpense?.splitMode !== 'individual') {
    return null;
  }
  const counterparts = Array.isArray(splitExpense.counterparts) ? splitExpense.counterparts : [];
  const isCreator = Boolean(me) && splitExpense.createdByUserId === me;
  if (isCreator) {
    return counterparts.length >= 2
      ? 'Balances for this expense are kept between you and each person.'
      : null;
  }
  const ownEntry = counterparts.find((entry) => me && entry.counterpartUserId === me);
  const pairId = ownEntry?.individualBalanceId ?? target?.individualBalanceId ?? null;
  if (!pairId) {
    return null;
  }
  const creator = shortName(splitExpense.createdByName);
  const effect = findPairEffect(splitExpense, pairId, me);
  // A short name already ends in '.', which also closes the sentence.
  const lead = `This expense is settled through ${creator}${creator.endsWith('.') ? '' : '.'}`;
  if (effect > 0) {
    return `${lead} For it, ${creator} owes you ${formatMoney(effect, symbol)}.`;
  }
  if (effect < 0) {
    return `${lead} For it, you owe ${creator} ${formatMoney(effect, symbol)}.`;
  }
  return `${lead} It doesn't change your balance with ${creator}.`;
}

/**
 * One person on Split Expense Detail.
 *
 * @param {{ userId?: string | null, name: string }} identity
 * @param {number} paid
 * @param {number} share
 * @returns {string} `{P} paid ₹A and owe(s) ₹S` · `{P} paid ₹A` · `{P} owe(s) ₹S`
 */
export function participantLine(identity, paid, share, me, symbol = DEFAULT_SYMBOL) {
  const isMe = isViewer(identity, me);
  const person = isMe ? 'You' : shortName(identity?.name);
  const owes = isMe ? 'owe' : 'owes';
  const paidPart = `${person} paid ${formatMoney(paid, symbol)}`;
  if (paid > 0 && share > 0) {
    return `${paidPart} and ${owes} ${formatMoney(share, symbol)}`;
  }
  if (paid > 0) {
    return paidPart;
  }
  return `${person} ${owes} ${formatMoney(share, symbol)}`;
}

/**
 * The delete confirmation's body (ADR 0028 §11.6).
 *
 * @param {{ title: string, groupName?: string | null, removesPersonalTransaction: boolean }} args
 * @returns {string}
 */
export function deleteSplitExpenseMessage({ title, groupName = null, removesPersonalTransaction }) {
  const audience = groupName ?? 'this split';
  const base = `"${title}" will be deleted for everyone in ${audience} and balances will be recalculated. Payments already recorded stay as they are.`;
  return removesPersonalTransaction ? `${base} It will also be removed from your expenses.` : base;
}

/**
 * Split Expense Detail's caption when the viewer may not edit (§11.3).
 *
 * @param {string | null} creatorName
 * @returns {string}
 */
export function creatorOnlyCaption(creatorName) {
  return `Only ${shortName(creatorName)} can edit or delete this expense.`;
}

/**
 * The balance block of a Split tab card and of Split Detail's header (§9.2):
 * - group: `groupSummarySentence`, then up to `maxDebts` of the viewer's own
 *   simplified debts (`debtSentence`), then `+{n} more`;
 * - pair: `pairBalanceSentence`.
 *
 * @param {{ isGroup: boolean, name?: string, yourBalance: number,
 *   viewerDebts?: Array<{ from: object, to: object, amount: number }>,
 *   me: string, symbol?: string, maxDebts?: number }} args
 * @returns {{ sentence: string, tone: 'positive' | 'negative' | 'muted',
 *   debtLines: string[], moreCount: number }}
 */
export function buildBalanceSummary({
  isGroup,
  name,
  yourBalance,
  viewerDebts = [],
  me,
  symbol = DEFAULT_SYMBOL,
  maxDebts = 2,
}) {
  const tone = yourBalance > 0 ? 'positive' : yourBalance < 0 ? 'negative' : 'muted';
  if (!isGroup) {
    return { sentence: pairBalanceSentence(name, yourBalance, symbol), tone, debtLines: [], moreCount: 0 };
  }
  return {
    sentence: groupSummarySentence(yourBalance, symbol),
    tone,
    debtLines: viewerDebts
      .slice(0, maxDebts)
      .map((debt) => debtSentence(debt.from, debt.to, debt.amount, me, symbol)),
    moreCount: Math.max(0, viewerDebts.length - maxDebts),
  };
}

/**
 * A Split tab card's balance block (§9.2): the pair sentence for an
 * Individual card; for a Group card, the group summary plus the viewer's own
 * simplified debts in that group.
 *
 * @param {{ isIndividual: boolean, item: object, me: string, symbol?: string }} args
 * @returns {{ sentence: string, tone: string, debtLines: string[], moreCount: number }}
 */
export function buildSplitCardSummary({ isIndividual, item, me, symbol = DEFAULT_SYMBOL }) {
  if (isIndividual) {
    return buildBalanceSummary({ isGroup: false, name: item.counterpartName, yourBalance: item.balance, me, symbol });
  }
  return buildBalanceSummary({
    isGroup: true,
    yourBalance: item.yourBalance,
    viewerDebts: describeGroupDebts(item, me).viewerDebts,
    me,
    symbol,
  });
}

/**
 * Settle Up's result line (§9.2): after a partial settlement, what remains;
 * after a full one, settled. `remaining` is signed from the viewer's side
 * (positive = they owe the viewer).
 *
 * @param {string} name
 * @param {number} remaining
 * @returns {string}
 */
export function remainingAfterSettlementSentence(name, remaining, symbol = DEFAULT_SYMBOL) {
  const short = shortName(name);
  if (remaining > 0) {
    return `${short} still owes you ${formatMoney(remaining, symbol)}`;
  }
  if (remaining < 0) {
    return `You still owe ${short} ${formatMoney(remaining, symbol)}`;
  }
  return `You and ${short} are settled up`;
}
