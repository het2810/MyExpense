import {
  describeOtherCounterparts,
  findCallerPaid,
  findCallerShare,
  findPairEffect,
} from './splitParticipants';
import {
  feedStatusText,
  feedStatusTone,
  legacySettlementTitle,
  payersLine,
  settlementTitle,
  tombstoneLine,
} from './balanceCopy';
import { formatCategoryPath } from './categories';

/**
 * The split feeds' client-side rules —
 * docs/decisions/0028-split-expense-edit-delete-feeds-and-balance-copy.md §7.
 *
 * The server sends no viewer status (§7.5): it is derived here, once, from the
 * data each item carries. The offline overlay feeds the same items through the
 * same function, so a queued edit reads exactly as the server's answer will.
 *
 * Pure JS, no React Native import (§14).
 */

/**
 * @param {number} value
 * @returns {number}
 */
function roundToPaise(value) {
  const rounded = Math.round(value * 100) / 100;
  return rounded === 0 ? 0 : rounded;
}

/**
 * A feed item's identity for de-duplication (§7.2: offset pagination can
 * repeat an item across pages, never skip one).
 *
 * @param {{ itemType: string, id: string }} item
 * @returns {string}
 */
export function feedItemKey(item) {
  return `${item.itemType}:${item.id}`;
}

/**
 * Appends a later page to the held items, dropping any item already held.
 *
 * @param {object[]} heldItems
 * @param {object[]} pageItems
 * @returns {object[]}
 */
export function appendFeedPage(heldItems, pageItems) {
  const seen = new Set(heldItems.map(feedItemKey));
  const additions = pageItems.filter((item) => !seen.has(feedItemKey(item)));
  return additions.length === 0 ? heldItems : [...heldItems, ...additions];
}

/**
 * The cache key of one feed target (§7.7).
 *
 * @param {{ groupId?: string | null, individualBalanceId?: string | null }} target
 * @returns {string | null}
 */
export function toFeedTargetKey(target) {
  if (target?.groupId) {
    return `group:${target.groupId}`;
  }
  if (target?.individualBalanceId) {
    return `pair:${target.individualBalanceId}`;
  }
  return null;
}

/**
 * Whether the viewer appears in a split as a payer or a participant.
 *
 * @param {object} splitExpense
 * @param {string} currentUserId
 * @returns {boolean}
 */
function isViewerInvolved(splitExpense, currentUserId) {
  if (!currentUserId) {
    return false;
  }
  const isPayer = (splitExpense.payers ?? []).some((payer) => payer.payerUserId === currentUserId);
  const isParticipant = (splitExpense.participants ?? []).some(
    (participant) => participant.participantUserId === currentUserId,
  );
  return isPayer || isParticipant;
}

/**
 * §7.8's table.
 *
 * | Item              | Status                                       |
 * |-------------------|----------------------------------------------|
 * | deleted split     | `deleted`                                    |
 * | group split       | `lent` / `borrowed` / `no_balance` / `not_involved` |
 * | pair split        | `owed` / `owe` / `no_balance`                |
 * | settlement        | `paid` / `received` / `not_involved`         |
 * | legacy settlement | `recorded`                                   |
 *
 * @param {object} item SplitFeedItemResponse.
 * @param {{ groupId?: string | null, individualBalanceId?: string | null }} target
 * @param {string} currentUserId
 * @returns {{ status: string, amount: number | null }}
 */
export function describeFeedItemForViewer(item, target, currentUserId) {
  if (item?.itemType === 'settlement' && item.settlement) {
    const { settlement } = item;
    if (!settlement.payer) {
      return { status: 'recorded', amount: settlement.amount };
    }
    if (currentUserId && settlement.payer.userId === currentUserId) {
      return { status: 'paid', amount: settlement.amount };
    }
    if (currentUserId && settlement.payee?.userId === currentUserId) {
      return { status: 'received', amount: settlement.amount };
    }
    return { status: 'not_involved', amount: null };
  }

  const splitExpense = item?.splitExpense;
  if (!splitExpense) {
    return { status: 'not_involved', amount: null };
  }
  if (splitExpense.deletedAt) {
    return { status: 'deleted', amount: null };
  }

  if (target?.individualBalanceId) {
    const effect = roundToPaise(
      findPairEffect(splitExpense, target.individualBalanceId, currentUserId),
    );
    if (effect > 0) {
      return { status: 'owed', amount: effect };
    }
    if (effect < 0) {
      return { status: 'owe', amount: Math.abs(effect) };
    }
    return { status: 'no_balance', amount: null };
  }

  if (!isViewerInvolved(splitExpense, currentUserId)) {
    return { status: 'not_involved', amount: null };
  }
  const net = roundToPaise(
    findCallerPaid(splitExpense, currentUserId) - findCallerShare(splitExpense, currentUserId),
  );
  if (net > 0) {
    return { status: 'lent', amount: net };
  }
  if (net < 0) {
    return { status: 'borrowed', amount: Math.abs(net) };
  }
  return { status: 'no_balance', amount: null };
}

/**
 * Everything one feed row says (§9.2's "Feed rows" line): the title (split
 * title, or the settlement sentence), the subtitle (payers, or "Deleted by …"),
 * the muted `Also with …` line on a pair feed, and the right-hand status.
 *
 * @param {object} item
 * @param {{ groupId?: string | null, individualBalanceId?: string | null }} target
 * @param {string} currentUserId
 * @param {{ symbol?: string, initiatorName?: string }} [options] `initiatorName`
 *   names a legacy settlement's initiator, which the item does not carry.
 * @returns {{ title: string, subtitle: string | null, secondarySubtitle: string | null,
 *   statusText: string, statusTone: string, glyph: string, glyphTone: string }}
 */
export function buildFeedRowCopy(item, target, currentUserId, { symbol, initiatorName } = {}) {
  const { status, amount } = describeFeedItemForViewer(item, target, currentUserId);
  const statusText = feedStatusText(status, amount, symbol);
  const statusTone = feedStatusTone(status);

  if (item.itemType === 'settlement' && item.settlement) {
    const { settlement } = item;
    return {
      title: settlement.payer
        ? settlementTitle(settlement.payer, settlement.payee, settlement.amount, currentUserId, symbol)
        : legacySettlementTitle(
            { userId: settlement.initiatedByUserId, name: initiatorName },
            settlement.amount,
            currentUserId,
            symbol,
          ),
      subtitle: null,
      secondarySubtitle: null,
      statusText,
      statusTone,
      glyph: '⇄',
      glyphTone: 'neutral',
    };
  }

  const splitExpense = item.splitExpense ?? {};
  const isDeleted = Boolean(splitExpense.deletedAt);
  return {
    title: splitExpense.title ?? '',
    // Same shape as a Dashboard row (Project Owner, 2026-11-12): the category
    // path first, then who paid.
    subtitle: isDeleted
      ? tombstoneLine(splitExpense, currentUserId)
      : [
          splitExpense.categoryName
            ? formatCategoryPath(splitExpense.parentCategoryName, splitExpense.categoryName)
            : null,
          payersLine(splitExpense, currentUserId, symbol),
        ]
          .filter(Boolean)
          .join(' • '),
    secondarySubtitle:
      !isDeleted && target?.individualBalanceId
        ? describeOtherCounterparts(splitExpense, target.individualBalanceId, currentUserId)
        : null,
    statusText,
    statusTone,
    glyph: splitExpense.categoryGlyph ?? 'M',
    glyphTone: isDeleted ? 'neutral' : splitExpense.categoryTone ?? 'neutral',
  };
}

/**
 * Only live split rows open Split Expense Detail; tombstones and settlements
 * are not tappable (§7.3, §11.2).
 *
 * @param {object} item
 * @returns {boolean}
 */
export function isFeedItemTappable(item) {
  return (
    item?.itemType === 'split_expense' &&
    Boolean(item.splitExpense) &&
    !item.splitExpense.deletedAt &&
    !item.splitExpense.isLocalPreview
  );
}

/**
 * Finds a split expense in a list of feed items.
 *
 * @param {object[]} items
 * @param {string} splitExpenseId
 * @returns {object | null}
 */
export function findSplitExpenseInFeed(items, splitExpenseId) {
  const match = (items ?? []).find(
    (item) => item.itemType === 'split_expense' && item.id === splitExpenseId,
  );
  return match?.splitExpense ?? null;
}
