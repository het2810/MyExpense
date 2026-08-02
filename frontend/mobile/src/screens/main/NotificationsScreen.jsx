import React from 'react';
import { View, Text, FlatList, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme/useTheme';
import { getTabBarTopEdge } from '../../theme/layout';
import { useNotifications } from '../../hooks/useNotifications';
import { getDateDisplayLabel, getTimeLabel } from '../../utils/dateDisplay';
import ScreenHeader from '../../components/ScreenHeader';
import TextButton from '../../components/TextButton';
import ListItem from '../../components/ListItem';
import IconBadge from '../../components/IconBadge';
import InlineMessage from '../../components/InlineMessage';

// Type -> icon/tone mapping — docs/decisions/0012-notifications-system.md
// §6. `group_expense`/`settlement` deliberately reuse the exact
// swap-horizontal-outline/accent pairing Activity Log already uses for the
// same money-movement concept; `overspending`/`reminder` reuse the
// warning/status.warning pairing design-system.md §1.1 already named for
// these PDF concepts before either had a real consumer.
//
// **This map is a lookup with a fallback, never an exhaustive switch.**
// `notifications.type` has no vocabulary CHECK in the schema and no
// server-side validation, and the contract returns it verbatim from an
// extensible union — so a client must tolerate a value it does not know
// (`backend/README.md` §17.8 flag 7). It is also wider than reality in the
// other direction: `overspending` and `reminder` have **no writer anywhere in
// the backend** (flag 8, §17.10), so those two entries cannot be reached
// today. They are kept rather than deleted — they are correct, they cost
// nothing, and the pass that adds those writers should not also have to
// re-derive this pairing.
const TYPE_ICON_MAP = {
  overspending: { glyph: '⚠', tone: 'warning' },
  group_expense: { glyph: '⇄', tone: 'accent' },
  settlement: { glyph: '⇄', tone: 'accent' },
  reminder: { glyph: '⏰', tone: 'warning' },
};

/**
 * Notifications — docs/decisions/0012-notifications-system.md §7,
 * docs/ui/design-system.md §15.5. Reached by tapping the header bell
 * (NotificationBell.jsx) on Dashboard, Split, Statistics or Profile.
 * Registered as a shared `Notifications` route in all four tab stacks (§8) —
 * the same component, four route registrations, so back navigation always
 * returns to the tab the user was already on.
 *
 * **Server-backed by `GET /api/v1/notifications` (api-overview.md §12.1),
 * `PATCH /notifications/{id}/read` (§12.2) and
 * `PATCH /notifications/read-all` (§12.3)** as of Domain 7's wiring step,
 * through `useNotifications()`. Until now it rendered an 11-entry mock seeded
 * inside its store.
 *
 * ---
 * **THE TWO WRITES, AND WHAT EACH ONE IS ALLOWED TO ASSUME.**
 *
 * - **Tapping a row** marks it read (§12.2) and does nothing else. No
 *   tap-through to a related transaction/group/split, and that is now
 *   structural rather than scoped: a `NotificationResponse` carries **no entity
 *   ids at all** — `message` is the whole payload — so **a notification is not
 *   navigable** (`backend/README.md` §17.3). Nothing here parses the sentence
 *   to invent one. The call is idempotent and the server skips the write on an
 *   already-read row, so the store short-circuits a tap on a read row instead
 *   of spending a request to be told nothing changed (§17.4).
 * - **"Mark all read"** (§12.3) answers a *message*, not data. So the store
 *   re-reads the list and the badge instead of mapping held rows to
 *   `read: true` — the server owns the `updated_at` that bulk `UPDATE` writes,
 *   and guessing it would leave this screen holding a timestamp the server
 *   never wrote (§17.4's `updated_at` discussion). The header action is
 *   disabled while that is in flight, and it is offered only while something is
 *   unread.
 *
 * `hasUnread` comes from `unreadCount` — the badge's own `totalElements` figure
 * — and **not** from `notifications.some(...)`: the list is paginated, so an
 * account whose only unread rows sit on page 3 would otherwise be offered no
 * way to clear them (`backend/README.md` §17.5).
 *
 * ---
 * **ORDER IS THE SERVER'S** (`notifDate` desc, `notifTime` desc, `id` desc) and
 * is never re-sorted here, for the reason §17.2 gives: one fan-out writes
 * several rows from one instant, so ties are normal and only the server's `id`
 * tie-break makes offset pagination stable.
 *
 * Read/unread visual distinction, unchanged: unread rows render their message
 * in text.primary with a small accent.primary filled dot in the row's trailing
 * slot; read rows render in text.secondary with no dot.
 */
function NotificationsScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const styles = createStyles(theme, insets);

  // This hook is the load trigger as well as the read, and it also forces the
  // unread probe — opening this screen is the moment the bell's cached count is
  // most likely to be stale.
  const {
    notifications,
    unreadCount,
    hasLoaded,
    isLoading,
    isLoadingMore,
    isMarkingAllRead,
    loadError,
    loadMoreError,
    markError,
    markRead,
    markAllRead,
    loadMore,
    reload,
  } = useNotifications();

  const hasUnread = unreadCount > 0;

  return (
    <View style={styles.flex}>
      <ScreenHeader
        title="Notifications"
        onBack={() => navigation.goBack()}
        rightSlot={
          hasUnread ? (
            <TextButton
              label={isMarkingAllRead ? 'Marking…' : 'Mark all read'}
              onPress={isMarkingAllRead ? undefined : markAllRead}
            />
          ) : null
        }
      />

      <FlatList
        // Fabric view-identity guard: FlatList defaults this to true on
        // Android, which attaches and detaches children outside Fabric's
        // own insert/remove instructions and can produce
        // "addViewAt ... child already has a parent" crashes.
        removeClippedSubviews={false}
        data={notifications}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        // The store ignores this while a read is in flight or the last page is
        // already held, so a fast scroll cannot stack up requests.
        onEndReached={loadMore}
        onEndReachedThreshold={0.3}
        ListHeaderComponent={
          // A failed mark-read belongs above the rows, because the row it
          // failed on is somewhere in the list and the user needs to be told
          // the tap did not take effect. Retrying is simply tapping again, so
          // this carries no Retry action of its own.
          markError ? <InlineMessage message={markError} style={styles.markError} /> : null
        }
        ListEmptyComponent={
          <NotificationsPlaceholder
            styles={styles}
            hasLoaded={hasLoaded}
            isLoading={isLoading}
            loadError={loadError}
            onRetry={reload}
          />
        }
        ListFooterComponent={
          // Pagination state below the rows rather than over them: a failed
          // next page must never blank a list the user is already reading
          // (constitution §22 — the rows on screen are still correct).
          <>
            {isLoadingMore ? (
              <Text style={styles.statusText}>Loading more notifications…</Text>
            ) : null}
            {loadMoreError ? <InlineMessage message={loadMoreError} onRetry={loadMore} /> : null}
          </>
        }
        renderItem={({ item }) => {
          const iconConfig = TYPE_ICON_MAP[item.type] ?? { glyph: '🔔', tone: 'neutral' };
          // Composed live from the server's `notifDate`/`notifTime` (§12.1) so
          // the "Today"/"Yesterday" label stays correct as today moves forward.
          // `notifTime` is the SERVER's clock in UTC, not the device's
          // (`backend/README.md` §17.8 flag 3) — a reader in another timezone
          // sees a time that is not theirs, which is flagged rather than
          // silently converted.
          const subtitle = `${getDateDisplayLabel(item.notifDate)} • ${getTimeLabel(item.notifTime)}`;

          return (
            <ListItem
              leading={<IconBadge glyph={iconConfig.glyph} tone={iconConfig.tone} />}
              title={item.message}
              subtitle={subtitle}
              titleTone={item.read ? 'secondary' : 'primary'}
              trailing={!item.read ? <View style={styles.unreadDot} /> : undefined}
              // Already-read rows keep an onPress so the row's own press
              // feedback is consistent; the store answers it without a request.
              onPress={() => markRead(item.id)}
            />
          );
        }}
      />
    </View>
  );
}

/**
 * The states this list has before it has rows, kept apart for the reason
 * constitution §22 and every other wired list in this app record: **a failed
 * read must never render the empty state.** "No notifications yet" for an
 * account whose request timed out is a false statement about their inbox.
 *
 * The genuine empty case is both reachable and likely: of §12's four
 * documented types only `group_expense` and `settlement` have a writer
 * anywhere in the backend, and notifications go to every *other* affected
 * member rather than the actor — so a user who only ever records their own
 * expenses legitimately has none (`backend/README.md` §17.3/§17.8 flag 8). The
 * copy therefore no longer promises overspending alerts or reminders, which
 * nothing can currently produce.
 *
 * @param {object} props
 * @param {object} props.styles
 * @param {boolean} props.hasLoaded
 * @param {boolean} props.isLoading
 * @param {string | null} props.loadError
 * @param {() => void} props.onRetry
 */
function NotificationsPlaceholder({ styles, hasLoaded, isLoading, loadError, onRetry }) {
  if (!hasLoaded && isLoading) {
    return <Text style={styles.statusText}>Loading notifications…</Text>;
  }

  if (!hasLoaded && loadError) {
    return <InlineMessage message={loadError} onRetry={onRetry} />;
  }

  if (!hasLoaded) {
    // The one-render gap before the load effect fires — deliberately blank.
    return null;
  }

  return (
    <View style={styles.emptyState}>
      <IconBadge glyph="🔔" tone="neutral" size="large" />
      <Text style={styles.emptyStateText}>
        No notifications yet. Shared expenses and settlements from the people you split with will
        show up here.
      </Text>
    </View>
  );
}

function createStyles(theme, insets) {
  return StyleSheet.create({
    flex: {
      flex: 1,
      backgroundColor: theme.color.background.base,
    },
    listContent: {
      flexGrow: 1,
      paddingHorizontal: theme.space.xl,
      paddingTop: theme.space.md,
      paddingBottom: getTabBarTopEdge(theme, insets) + theme.space.lg,
    },
    markError: {
      marginBottom: theme.space.md,
    },
    unreadDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: theme.color.accent.primary,
    },
    statusText: {
      color: theme.color.text.secondary,
      fontSize: theme.type.body.fontSize,
      lineHeight: theme.type.body.lineHeight,
      textAlign: 'center',
      paddingVertical: theme.space.lg,
    },
    emptyState: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingTop: theme.space.xxxl,
    },
    emptyStateText: {
      color: theme.color.text.secondary,
      fontSize: theme.type.body.fontSize,
      lineHeight: theme.type.body.lineHeight,
      textAlign: 'center',
      marginTop: theme.space.md,
    },
  });
}

export default NotificationsScreen;
