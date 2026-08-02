import React from 'react';
import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
import { useTheme } from '../theme/useTheme';
import InlineMessage from './InlineMessage';
import TextButton from './TextButton';

/**
 * What a contact picker shows instead of its list while the device address
 * book is not readable yet: loading, access refused (ask again), access blocked
 * (open Settings), or a failed read (retry). Renders nothing once `status` is
 * `'ready'` — the host then shows its list or its own empty copy.
 *
 * @param {{
 *   status: string,
 *   onRequestAccess: () => void,
 *   onOpenSettings: () => void,
 *   onRetry: () => void,
 *   style?: object,
 * }} props `status` is `useDeviceContacts().status`.
 */
function DeviceContactsNotice({ status, onRequestAccess, onOpenSettings, onRetry, style }) {
  const theme = useTheme();
  const styles = createStyles(theme);

  if (status === 'ready') {
    return null;
  }

  if (status === 'error') {
    return (
      <InlineMessage message="Couldn't read the contacts on this device." onRetry={onRetry} style={style} />
    );
  }

  if (status === 'denied') {
    return (
      <View style={[styles.container, style]}>
        <Text style={styles.text}>
          MyExpense needs access to your contacts so you can pick who to split with.
        </Text>
        <TextButton label="Allow access" onPress={onRequestAccess} />
      </View>
    );
  }

  if (status === 'blocked') {
    return (
      <View style={[styles.container, style]}>
        <Text style={styles.text}>
          Contacts access is turned off for MyExpense. Turn it on in Settings to pick who to split
          with.
        </Text>
        <TextButton label="Open Settings" onPress={onOpenSettings} />
      </View>
    );
  }

  // 'idle' | 'requesting' | 'loading'
  return (
    <View style={[styles.loadingRow, style]}>
      <ActivityIndicator color={theme.color.accent.primary} />
      <Text style={styles.loadingText}>Loading your contacts…</Text>
    </View>
  );
}

function createStyles(theme) {
  return StyleSheet.create({
    container: {
      paddingVertical: theme.space.sm,
    },
    text: {
      color: theme.color.text.secondary,
      fontSize: theme.type.body.fontSize,
      lineHeight: theme.type.body.lineHeight,
      marginBottom: theme.space.sm,
    },
    loadingRow: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: theme.space.md,
    },
    loadingText: {
      color: theme.color.text.secondary,
      fontSize: theme.type.body.fontSize,
      marginLeft: theme.space.sm,
    },
  });
}

export default DeviceContactsNotice;
