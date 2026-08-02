import { useMemo } from 'react';
import { useSplitFeedStore } from '../store/useSplitFeedStore';
import { findSplitExpenseInFeed } from '../utils/splitFeed';
import {
  buildEditRoster,
  buildSplitConfigFromSplitExpense,
} from '../utils/splitEdit';
import { joinPayerLabels, resolveSplitExpenseCounterparts } from '../utils/splitParticipants';
import { useActiveOps } from './useActiveOps';
import { useGroupsView } from './useGroupsView';
import { useUserIdentity } from './useUserIdentity';

const NOT_EDITING = { isEditing: false, isMissing: false, splitExpense: null };

/**
 * Split Add Expense's edit mode —
 * docs/decisions/0028-split-expense-edit-delete-feeds-and-balance-copy.md §11.5.
 * Everything the screen needs to open on a saved split, so the screen itself
 * only branches on `isEditing`:
 *
 * - the split, read from the feed cache (works offline, §7.5), with any
 *   still-queued edit of it applied so a second offline edit starts from the
 *   first one's result;
 * - the fixed roster (`buildEditRoster`) — the audience is immutable (§2.2);
 * - `initialForm`, consumed once by the screen's initial state (prefill via
 *   `buildSplitConfigFromSplitExpense`);
 * - `canEditCategory` (creator only, U2) and the locked-target copy.
 *
 * @param {string | null | undefined} editingSplitExpenseId
 * @returns {object}
 */
export function useSplitExpenseEditing(editingSplitExpenseId) {
  const targets = useSplitFeedStore((state) => state.targets);
  const ops = useActiveOps('splitFeed', null);
  const groups = useGroupsView();
  const identity = useUserIdentity();

  return useMemo(() => {
    if (!editingSplitExpenseId) {
      return NOT_EDITING;
    }
    let splitExpense = null;
    Object.values(targets).some((entry) => {
      splitExpense = findSplitExpenseInFeed(entry.items, editingSplitExpenseId);
      return Boolean(splitExpense);
    });
    ops
      .filter((op) => op.type === 'split.update' && op.entityId === editingSplitExpenseId)
      .forEach((op) => {
        splitExpense = op.preview?.after ?? splitExpense;
      });
    if (!splitExpense || splitExpense.deletedAt) {
      return { ...NOT_EDITING, isEditing: true, isMissing: true };
    }

    const isGroup = splitExpense.splitMode === 'group';
    const group = isGroup ? groups.find((item) => item.id === splitExpense.groupId) ?? null : null;
    const roster = buildEditRoster({ splitExpense, group, identity });
    const counterpartNames = resolveSplitExpenseCounterparts(splitExpense).map(
      (counterpart) => counterpart.name || 'Someone',
    );

    return {
      isEditing: true,
      isMissing: false,
      splitExpense,
      group,
      roster,
      // U2: only the creator may change the category. A server that predates
      // ADR 0028 sends no creator, so the server's own check decides.
      canEditCategory: !splitExpense.createdByUserId || splitExpense.createdByUserId === identity.userId,
      initialForm: {
        amount: String(splitExpense.amount),
        title: splitExpense.title,
        selectedCategory: splitExpense.categoryId
          ? {
              id: splitExpense.categoryId,
              name: splitExpense.categoryName,
              parentCategoryName: splitExpense.parentCategoryName ?? null,
              glyph: splitExpense.categoryGlyph,
              iconName: splitExpense.categoryIconName ?? null,
            }
          : null,
        selectedDate: splitExpense.splitDate,
        splitMode: splitExpense.splitMode,
        splitConfig: buildSplitConfigFromSplitExpense(splitExpense, identity.userId, roster),
      },
      lockedTarget: {
        modeLabel: isGroup ? 'Group' : 'Individual',
        targetLabel: isGroup ? 'GROUP' : 'CONTACT',
        targetText: isGroup ? group?.name ?? 'This group' : joinPayerLabels(counterpartNames),
      },
    };
  }, [editingSplitExpenseId, targets, ops, groups, identity]);
}

/**
 * The category snapshot an edit previews offline (ADR 0028 §7.7), from the
 * CATEGORY field's selection.
 *
 * @param {object | null} category
 * @returns {object | null}
 */
export function toCategorySnapshot(category) {
  if (!category) {
    return null;
  }
  return {
    categoryId: category.id,
    categoryName: category.name,
    parentCategoryName: category.parentCategoryName ?? null,
    categoryIconName: category.iconName ?? null,
    categoryGlyph: category.glyph,
  };
}
