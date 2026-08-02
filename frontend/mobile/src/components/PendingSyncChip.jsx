import React from 'react';
import { Text, StyleSheet } from 'react-native';
import { useTheme } from '../theme/useTheme';
import { describeLocalSyncStatus } from '../utils/syncDisplay';

/**
 * "Waiting to sync" / "Couldn't sync" on a row the offline overlay produced —
 * docs/decisions/0027-offline-first-local-cache-and-replay-sync.md §8.8.
 * Renders nothing for a server row (`localSyncStatus` null).
 *
 * @param {{ status: 'pending' | 'failed' | 'blocked' | null | undefined, style?: object }} props
 */
function PendingSyncChip({ status, style }) {
  const theme = useTheme();
  const styles = createStyles(theme);
  const label = describeLocalSyncStatus(status);
  if (!label) {
    return null;
  }
  const isProblem = status === 'failed' || status === 'blocked';
  return (
    <Text style={[styles.chip, isProblem ? styles.problem : styles.pending, style]}>{label}</Text>
  );
}

function createStyles(theme) {
  return StyleSheet.create({
    chip: {
      alignSelf: 'flex-start',
      overflow: 'hidden',
      borderRadius: theme.radius.pill,
      paddingHorizontal: theme.space.sm,
      paddingVertical: 2,
      fontSize: theme.type.caption.fontSize,
      lineHeight: theme.type.caption.lineHeight,
      fontWeight: '600',
      backgroundColor: theme.color.background.surfaceAlt,
    },
    pending: {
      color: theme.color.status.warning,
    },
    problem: {
      color: theme.color.status.negative,
    },
  });
}

export default PendingSyncChip;
