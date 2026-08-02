import React from 'react';
import { View, Text, FlatList, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useTheme } from '../../theme/useTheme';
import { getTabBarTopEdge } from '../../theme/layout';
import { useNotificationsStore } from '../../store/useNotificationsStore';
import { getDateDisplayLabel, getTimeLabel } from '../../utils/dateDisplay';
import ScreenHeader from '../../components/ScreenHeader';
import TextButton from '../../components/TextButton';
import ListItem from '../../components/ListItem';
import IconBadge from '../../components/IconBadge';

// Type -> icon/tone mapping — docs/decisions/0012-notifications-system.md
// §6. `group_expense`/`settlement` deliberately reuse the exact
// swap-horizontal-outline/accent pairing Activity Log already uses for the
// same money-movement concept; `overspending`/`reminder` reuse the
// warning/status.warning pairing design-system.md §1.1 already named for
// these PDF concepts before either had a real consumer.
const TYPE_ICON_MAP = {
  overspending: { glyph: '⚠', tone: 'warning' },
  group_expense: { glyph: '⇄', tone: 'accent' },
  settlement: { glyph: '⇄', tone: 'accent' },
  reminder: { glyph: '⏰', tone: 'warning' },
};

/**
 * Notifications — minimum-viable list screen, docs/decisions/
 * 0012-notifications-system.md §7, docs/ui/design-system.md §15.5. Reached
 * by tapping the header bell (NotificationBell.jsx) on Dashboard, Split, or
 * Profile. Registered as a shared `Notifications` route in all three tab
 * stacks (§8) — the same component, three route registrations, so back
 * navigation always returns to the tab the user was already on.
 *
 * Read/unread visual distinction, minimum viable (no swipe actions, no
 * per-row menu): unread rows render their message in text.primary with a
 * small accent.primary filled dot in the row's trailing slot; read rows
 * render in text.secondary with no dot. Tapping a row marks it read only —
 * no tap-through navigation to a related transaction/group/split, mirroring
 * Activity Log's identical scoping call (docs/decisions/
 * 0008-activity-log-system.md §4).
 */
function NotificationsScreen() {
  const theme = useTheme();
  const navigation = useNavigation();
  const styles = createStyles(theme);

  const notifications = useNotificationsStore((state) => state.notifications);
  const markAsRead = useNotificationsStore((state) => state.markAsRead);
  const markAllRead = useNotificationsStore((state) => state.markAllRead);

  const hasUnread = notifications.some((notification) => !notification.read);

  return (
    <View style={styles.flex}>
      <ScreenHeader
        title="Notifications"
        onBack={() => navigation.goBack()}
        rightSlot={
          hasUnread ? <TextButton label="Mark all read" onPress={markAllRead} /> : null
        }
      />

      <FlatList
        data={notifications}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>
              No notifications yet. Overspending alerts, group activity, and reminders will show
              up here.
            </Text>
          </View>
        }
        renderItem={({ item }) => {
          const iconConfig = TYPE_ICON_MAP[item.type] ?? { glyph: '🔔', tone: 'neutral' };
          const subtitle = `${getDateDisplayLabel(item.date)} • ${getTimeLabel(item.time)}`;

          return (
            <ListItem
              leading={<IconBadge glyph={iconConfig.glyph} tone={iconConfig.tone} />}
              title={item.message}
              subtitle={subtitle}
              titleTone={item.read ? 'secondary' : 'primary'}
              trailing={!item.read ? <View style={styles.unreadDot} /> : undefined}
              onPress={() => markAsRead(item.id)}
            />
          );
        }}
      />
    </View>
  );
}

function createStyles(theme) {
  return StyleSheet.create({
    flex: {
      flex: 1,
      backgroundColor: theme.color.background.base,
    },
    listContent: {
      flexGrow: 1,
      paddingHorizontal: theme.space.xl,
      paddingTop: theme.space.md,
      paddingBottom: getTabBarTopEdge(theme) + theme.space.lg,
    },
    unreadDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: theme.color.accent.primary,
    },
    emptyContainer: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingTop: theme.space.xxxl,
    },
    emptyText: {
      color: theme.color.text.secondary,
      fontSize: theme.type.body.fontSize,
      lineHeight: theme.type.body.lineHeight,
      textAlign: 'center',
    },
  });
}

export default NotificationsScreen;
