import React from 'react';
import { View } from 'react-native';
import { buildFeedRowCopy, isFeedItemTappable } from '../utils/splitFeed';
import ListItem from './ListItem';
import IconBadge from './IconBadge';
import Checkbox from './Checkbox';
import PendingSyncChip from './PendingSyncChip';

/**
 * One row of a group's or pair's feed — docs/decisions/
 * 0028-split-expense-edit-delete-feeds-and-balance-copy.md §7.6/§9.2/§11.2:
 * the icon (the category badge for an expense, `⇄` for a
 * settlement), the title and subtitle, and the viewer-relative status on the
 * right. Every sentence comes from `utils/splitFeed.js#buildFeedRowCopy`.
 *
 * Only a live expense is tappable; tombstones and settlements are not (§7.3).
 *
 * @param {{ item: object, target: object, currentUserId: string,
 *   currencySymbol?: string, initiatorName?: string,
 *   onOpenSplitExpense?: (item: object) => void,
 *   isSelecting?: boolean, isSelectable?: boolean, isSelected?: boolean,
 *   onStartSelection?: () => void, onToggleSelection?: () => void }} props
 *
 * Multi-select (all optional; omitted, the row behaves as before): a long
 * press on a selectable row starts selection; while selecting, a tap toggles a
 * selectable row and does nothing on the others (settlements, tombstones,
 * expenses the viewer may not delete).
 */
function SplitFeedRow({
  item,
  target,
  currentUserId,
  currencySymbol,
  initiatorName,
  onOpenSplitExpense,
  isSelecting = false,
  isSelectable = false,
  isSelected = false,
  onStartSelection,
  onToggleSelection,
}) {
  const copy = buildFeedRowCopy(item, target, currentUserId, {
    symbol: currencySymbol,
    initiatorName,
  });
  const isTappable = isFeedItemTappable(item) && typeof onOpenSplitExpense === 'function';
  let onPress;
  if (isSelecting) {
    onPress = isSelectable ? onToggleSelection : undefined;
  } else if (isTappable) {
    onPress = () => onOpenSplitExpense(item);
  }

  return (
    <View>
      <ListItem
        leading={
          // The date lives in the day header (same as the Dashboard).
          isSelecting && isSelectable ? (
            <Checkbox checked={isSelected} />
          ) : (
            <IconBadge glyph={copy.glyph} tone={copy.glyphTone} />
          )
        }
        title={copy.title}
        titleTone={copy.statusTone === 'muted' && item.splitExpense?.deletedAt ? 'secondary' : 'primary'}
        subtitle={copy.subtitle}
        secondarySubtitle={copy.secondarySubtitle}
        trailingText={copy.statusText}
        trailingTone={copy.statusTone}
        onPress={onPress}
        onLongPress={!isSelecting && isSelectable ? onStartSelection : undefined}
        selected={isSelected}
      />
      {item.localSyncStatus ? <PendingSyncChip status={item.localSyncStatus} /> : null}
    </View>
  );
}

export default SplitFeedRow;
