import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSplitFeedStore } from '../store/useSplitFeedStore';
import { canEditSplitExpense, toParticipantKey } from '../utils/splitEdit';
import { resolveSplitExpensePayers } from '../utils/splitParticipants';
import { creatorOnlyCaption, deleteSplitExpenseMessage, participantLine, routingNote } from '../utils/balanceCopy';
import { useSplitFeedView } from './useSplitFeedView';
import { useSplitExpenseSave } from './useSplitExpenseSave';
import { useGroupsView } from './useGroupsView';
import { useTransactionsView } from './useTransactionsView';
import { useUserIdentity } from './useUserIdentity';

/**
 * Everything Split Expense Detail shows and does —
 * docs/decisions/0028-split-expense-edit-delete-feeds-and-balance-copy.md
 * §11.3–§11.6.
 *
 * - The split comes from the target's feed (cache + queued ops), so the
 *   screen works offline. When the item is server data (no queued op on it),
 *   it is refreshed once with `GET /split-expenses/{id}`; a `404` becomes
 *   `isDeletedRemotely` ("This expense was deleted.").
 * - `people`: one `participantLine` per payer or participant, viewer first.
 * - `canEdit` (§11.4, a UX check — the server re-checks), else the
 *   creator-only caption.
 * - `deleteMessage` (§11.6) and `deleteSplitExpense`.
 *
 * @param {{ splitExpenseId: string, target: object, currencySymbol?: string }} args
 * @returns {object}
 */
export function useSplitExpenseDetail({ splitExpenseId, target, currencySymbol }) {
  const feed = useSplitFeedView(target ?? {});
  const refreshSplitExpense = useSplitFeedStore((state) => state.refreshSplitExpense);
  const { deleteSplitExpense, isSaving } = useSplitExpenseSave();
  const groups = useGroupsView();
  const transactions = useTransactionsView();
  const { userId } = useUserIdentity();
  const [isDeletedRemotely, setIsDeletedRemotely] = useState(false);

  const item = feed.items.find(
    (entry) => entry.itemType === 'split_expense' && entry.id === splitExpenseId,
  );
  const splitExpense = item?.splitExpense ?? null;
  const isServerRow = Boolean(splitExpense) && !item.localSyncStatus && !splitExpense.isLocalPreview;

  useEffect(() => {
    if (!isServerRow) {
      return undefined;
    }
    let isActive = true;
    refreshSplitExpense(splitExpenseId).then((result) => {
      if (isActive && result.outcome === 'not_found') {
        setIsDeletedRemotely(true);
      }
    });
    return () => {
      isActive = false;
    };
    // `isServerRow` stays true across the refresh it causes, so this runs
    // once per open (and again only after a queued op on it is synced).
  }, [splitExpenseId, refreshSplitExpense, isServerRow]);

  const details = useMemo(() => {
    if (!splitExpense) {
      return null;
    }
    const people = new Map();
    const personFor = (personUserId, personContactId, name) => {
      const key = toParticipantKey(personUserId, personContactId, userId);
      if (!people.has(key)) {
        people.set(key, { key, userId: personUserId ?? null, name: name || 'Someone', paid: 0, share: 0 });
      }
      return people.get(key);
    };
    resolveSplitExpensePayers(splitExpense).forEach((payer) => {
      personFor(payer.payerUserId, payer.payerContactId, payer.name).paid += Number(payer.amount || 0);
    });
    (splitExpense.participants ?? []).forEach((participant) => {
      personFor(participant.participantUserId, participant.participantContactId, participant.name).share +=
        Number(participant.amount || 0);
    });
    const lines = [...people.values()]
      .sort((left, right) => Number(right.key === 'self') - Number(left.key === 'self'))
      .map((person) => ({
        key: person.key,
        text: participantLine(person, person.paid, person.share, userId, currencySymbol),
      }));

    const isCreator = Boolean(userId) && splitExpense.createdByUserId === userId;
    const groupName =
      splitExpense.splitMode === 'group'
        ? groups.find((group) => group.id === splitExpense.groupId)?.name ?? null
        : null;
    const hasLivePersonalTransaction =
      isCreator &&
      Boolean(splitExpense.personalTransactionId) &&
      transactions.some((transaction) => transaction.id === splitExpense.personalTransactionId);

    return {
      lines,
      addedBy: isCreator ? 'You' : splitExpense.createdByName ?? null,
      routing: routingNote(splitExpense, target, userId, currencySymbol),
      canEdit: canEditSplitExpense(splitExpense, userId),
      creatorCaption: creatorOnlyCaption(splitExpense.createdByName),
      deleteMessage: deleteSplitExpenseMessage({
        title: splitExpense.title,
        groupName,
        removesPersonalTransaction: hasLivePersonalTransaction,
      }),
    };
  }, [splitExpense, userId, groups, transactions, target, currencySymbol]);

  const remove = useCallback(() => deleteSplitExpense(splitExpense), [deleteSplitExpense, splitExpense]);

  return {
    splitExpense,
    details,
    localSyncStatus: item?.localSyncStatus ?? null,
    // A tombstone in the feed (deleted here or on another device) reads the
    // same as a `404` from the refresh.
    isDeleted: isDeletedRemotely || Boolean(splitExpense?.deletedAt),
    hasLoaded: feed.hasLoaded,
    loadError: feed.loadError,
    reload: feed.reload,
    isDeleting: isSaving,
    deleteSplitExpense: remove,
  };
}
