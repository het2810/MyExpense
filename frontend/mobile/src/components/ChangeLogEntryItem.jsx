import React from 'react';
import { Pressable, Text, View, StyleSheet } from 'react-native';
import { useTheme } from '../theme/useTheme';
import {
  describeChangeHeadline,
  describeChangeLines,
  describeChangeTiming,
} from '../utils/changeLogDisplay';
import PendingSyncChip from './PendingSyncChip';

/**
 * One change-log entry — field diffs, timing, device, outcome
 * (docs/decisions/0027-offline-first-local-cache-and-replay-sync.md §6.6).
 * Used by Transaction Detail's ACTIVITY card and by Change Detail.
 * A queued entry (`localSyncStatus`) shows its chip and the attempted values.
 *
 * @param {{
 *   entry: object,
 *   currencySymbol: string,
 *   thisDeviceId: string | null,
 *   isLast?: boolean,
 *   onPress?: (() => void) | null,
 * }} props
 */
function ChangeLogEntryItem({ entry, currencySymbol, thisDeviceId, isLast = false, onPress = null }) {
  const theme = useTheme();
  const styles = createStyles(theme, isLast);
  const isSuperseded = entry.outcome === 'superseded';

  const content = (
    <View style={styles.row}>
      <View style={styles.headlineRow}>
        <Text style={[styles.headline, isSuperseded ? styles.warning : null]}>
          {describeChangeHeadline(entry)}
        </Text>
        <PendingSyncChip status={entry.localSyncStatus} />
      </View>
      {describeChangeLines(entry, currencySymbol).map((line) => (
        <Text key={line} style={styles.line}>
          {line}
        </Text>
      ))}
      <Text style={styles.timing}>{describeChangeTiming(entry, thisDeviceId)}</Text>
    </View>
  );

  if (!onPress) {
    return content;
  }
  return (
    <Pressable onPress={onPress} accessibilityRole="button">
      {content}
    </Pressable>
  );
}

function createStyles(theme, isLast) {
  return StyleSheet.create({
    row: {
      paddingVertical: theme.space.sm,
      borderBottomWidth: isLast ? 0 : StyleSheet.hairlineWidth,
      borderBottomColor: theme.color.border.subtle,
    },
    headlineRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    headline: {
      color: theme.color.text.primary,
      fontSize: theme.type.body.fontSize,
      fontWeight: '600',
    },
    warning: {
      color: theme.color.status.warning,
    },
    line: {
      marginTop: 2,
      color: theme.color.text.secondary,
      fontSize: theme.type.body.fontSize,
      lineHeight: theme.type.body.lineHeight,
    },
    timing: {
      marginTop: theme.space.xs,
      color: theme.color.text.tertiary,
      fontSize: theme.type.caption.fontSize,
      lineHeight: theme.type.caption.lineHeight,
    },
  });
}

export default ChangeLogEntryItem;
