import React from 'react';
import { Text, StyleSheet } from 'react-native';
import { useTheme } from '../theme/useTheme';
import { useChangeLogView } from '../hooks/useChangeLogView';
import Card from './Card';
import InlineMessage from './InlineMessage';
import ChangeLogEntryItem from './ChangeLogEntryItem';

/**
 * Transaction Detail's ACTIVITY card, now read from the server change log —
 * `GET /change-log?entityType=transaction&entityId={id}`
 * (docs/decisions/0027-offline-first-local-cache-and-replay-sync.md §6.6).
 * Offline it shows the cached entries plus this transaction's queued changes.
 * Replaces the local-only `useActivityLogStore` history as this card's source.
 *
 * Omitted entirely when there is nothing to show and nothing failed, the same
 * convention as the NOTES / RECEIPT cards.
 *
 * @param {{ transactionId: string, currencySymbol: string,
 *   onOpenEntry: (entryId: string) => void, style?: object }} props
 */
function ChangeLogCard({ transactionId, currencySymbol, onOpenEntry, style }) {
  const theme = useTheme();
  const styles = createStyles(theme);
  const { entries, loadError, hasEntries, reload, thisDeviceId } = useChangeLogView(
    'transaction',
    transactionId,
  );

  if (!hasEntries && !loadError) {
    return null;
  }

  return (
    <Card style={style}>
      <Text style={styles.label}>ACTIVITY</Text>
      {hasEntries ? null : <InlineMessage message={loadError} onRetry={reload} />}
      {entries.map((entry, index) => (
        <ChangeLogEntryItem
          key={entry.id}
          entry={entry}
          currencySymbol={currencySymbol}
          thisDeviceId={thisDeviceId}
          isLast={index === entries.length - 1}
          onPress={entry.localSyncStatus ? null : () => onOpenEntry(entry.id)}
        />
      ))}
    </Card>
  );
}

function createStyles(theme) {
  return StyleSheet.create({
    label: {
      color: theme.color.text.tertiary,
      fontSize: theme.type.label.fontSize,
      fontWeight: theme.type.label.fontWeight,
      letterSpacing: theme.type.label.letterSpacing,
      marginBottom: theme.space.xs,
    },
  });
}

export default ChangeLogCard;
