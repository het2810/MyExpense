import React from 'react';
import { Pressable, Text, View, StyleSheet } from 'react-native';
import { useTheme } from '../theme/useTheme';

/**
 * The offline / syncing / failed-sync strip —
 * docs/decisions/0027-offline-first-local-cache-and-replay-sync.md §8.9.
 * Rendered once, by MainTabs, directly below the top safe-area inset.
 * Presentational: copy and state come from `useSyncStatus`.
 *
 * @param {{
 *   message: string,
 *   actionLabel?: string | null,
 *   tone?: 'neutral' | 'negative',
 *   topInset?: number,
 *   onPress: () => void,
 * }} props
 */
function OfflineBanner({ message, actionLabel = null, tone = 'neutral', topInset = 0, onPress }) {
  const theme = useTheme();
  const styles = createStyles(theme, topInset);
  const textStyle = tone === 'negative' ? styles.negativeText : styles.text;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${message} Open sync status.`}
      style={styles.container}
    >
      <View style={styles.row}>
        <Text style={[styles.message, textStyle]}>{message}</Text>
        {actionLabel ? <Text style={styles.action}>{actionLabel}</Text> : null}
      </View>
    </Pressable>
  );
}

function createStyles(theme, topInset) {
  return StyleSheet.create({
    container: {
      backgroundColor: theme.color.background.surfaceAlt,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: theme.color.border.subtle,
      paddingTop: topInset + theme.space.sm,
      paddingBottom: theme.space.sm,
      paddingHorizontal: theme.space.lg,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    message: {
      flex: 1,
      fontSize: theme.type.caption.fontSize + 1,
      lineHeight: theme.type.caption.lineHeight + 2,
    },
    text: {
      color: theme.color.text.secondary,
    },
    negativeText: {
      color: theme.color.status.negative,
    },
    action: {
      marginLeft: theme.space.md,
      color: theme.color.accent.text,
      fontSize: theme.type.label.fontSize,
      fontWeight: theme.type.label.fontWeight,
    },
  });
}

export default OfflineBanner;
