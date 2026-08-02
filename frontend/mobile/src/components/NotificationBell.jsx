import React from 'react';
import { Pressable, Text, View, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useTheme } from '../theme/useTheme';
import { useNotificationsStore } from '../store/useNotificationsStore';

/**
 * Header bell icon button — docs/decisions/0012-notifications-system.md §2.
 * Structurally mirrors ThemeToggleButton.jsx exactly (a Pressable rendering
 * one glyph, reading a store, no extra wrapper component needed elsewhere):
 * a bell glyph (🔔, the already-approved Text-glyph placeholder for
 * `notifications-outline`, design-system.md §6) plus a conditionally
 * rendered unread-count badge (§4).
 *
 * Placement — ScreenHeader's rightSlot, BEFORE ThemeToggleButton, on
 * Dashboard, Split, and Profile (the header cluster becomes
 * `[bell][theme toggle][avatar]`, or `[bell][theme toggle]` on Profile,
 * which already omits the header avatar for its own unrelated reason).
 *
 * onPress navigates to whichever tab stack's own `Notifications`
 * registration is nearest — the same shared screen component, registered
 * once per tab stack (MyExpenseStack/SplitStack/ProfileStack), so back
 * navigation always returns to the tab the user was already on.
 */
function NotificationBell({ style }) {
  const theme = useTheme();
  const navigation = useNavigation();
  const notifications = useNotificationsStore((state) => state.notifications);
  const unreadCount = notifications.filter((notification) => !notification.read).length;
  const styles = createStyles(theme);

  return (
    <Pressable
      onPress={() => navigation.navigate('Notifications')}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel="Notifications"
      style={[styles.button, style]}
    >
      <Text style={styles.glyph}>🔔</Text>
      {unreadCount > 0 ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{unreadCount > 9 ? '9+' : unreadCount}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

function createStyles(theme) {
  return StyleSheet.create({
    button: {
      width: 36,
      height: 36,
      borderRadius: theme.radius.circle,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.color.background.surfaceAlt,
    },
    glyph: {
      color: theme.color.accent.text,
      fontSize: 16,
    },
    // Unread badge — docs/ui/design-system.md §15.2's exact visual spec:
    // absolute top-right of the bell glyph, overlapping slightly, a circle
    // that pill-stretches under 2-digit content, filled with
    // status.negative, text in the new status.onNegative token. Fully
    // omitted (not rendered at all) when unreadCount is 0 — handled above,
    // not here.
    badge: {
      position: 'absolute',
      top: -4,
      right: -6,
      minWidth: 16,
      height: 16,
      borderRadius: 8,
      paddingHorizontal: 3,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.color.status.negative,
    },
    badgeText: {
      color: theme.color.status.onNegative,
      fontSize: 10,
      fontWeight: '700',
    },
  });
}

export default NotificationBell;
