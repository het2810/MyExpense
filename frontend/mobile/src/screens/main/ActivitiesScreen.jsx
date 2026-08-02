import React from 'react';
import { View, Text, FlatList, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme/useTheme';
import { getTabBarTopEdge } from '../../theme/layout';
import { useActivities } from '../../hooks/useActivities';
import ScreenHeader from '../../components/ScreenHeader';
import ActivityLogItem from '../../components/ActivityLogItem';
import IconBadge from '../../components/IconBadge';
import InlineMessage from '../../components/InlineMessage';

/**
 * Activities — the global, unfiltered activity feed (docs/decisions/
 * 0008-activity-log-system.md §5, docs/ui/design-system.md §12.4). Reached
 * from Profile's "Activities" preferences row. A plain stack push within
 * ProfileStack.jsx, registered as `Activities`.
 *
 * **Server-backed by `GET /api/v1/activities`** (docs/api/api-overview.md
 * §11.1) as of Domain 7's wiring step, through `useActivities()`. Until now it
 * rendered `useActivityLogStore`, a local store this app wrote into itself.
 *
 * ---
 * **THE ORDER IS THE SERVER'S, AND THIS SCREEN DOES NOT TOUCH IT.**
 *
 * Rows are rendered in exactly the order `content` arrived: `activityDate`
 * desc, `activityTime` desc, `id` desc (`backend/README.md` §17.1). There is no
 * `sort` anywhere on this screen and there must never be one — **a single
 * fan-out writes several rows from one computed instant**, so ties on the
 * date/time pair are normal, and a client re-sort would not reproduce the
 * server's `id` tie-break. It would therefore disagree about which rows belong
 * to which page, and the user would see one entry twice and another not at all
 * (§17.2).
 *
 * ---
 * **FOUR STATES, NOT TWO — AND THE EMPTY ONE IS THE DANGEROUS ONE.**
 *
 * `ActivitiesPlaceholder` keeps loading, failed, not-yet-started and genuinely
 * empty apart. "No activity yet" in front of a user whose request *failed* is a
 * lie (constitution §22), so the empty copy renders only once `hasLoaded` is
 * true; a failure renders the message with a Retry instead.
 *
 * **The genuine empty state is expected to be common, and the copy says less
 * than it used to because of it.** Only `split_saved` and `settlement` have a
 * writer anywhere in the backend — `group_created` and `transaction_edited`
 * cannot appear in this response at all (`backend/README.md` §17.8 flag 8,
 * §17.10) — so the old copy's promise that "editing an expense … or creating a
 * group will show up here" would be false. Nothing is seeded or padded to make
 * the feed look fuller than it is.
 *
 * ---
 * Pagination (§11.1) is a `FlatList` + `onEndReached`, with the next page's
 * state rendered **below** the rows: a failed next page must never blank a list
 * the user is already reading. Same arrangement as
 * CategoryTransactionsScreen.jsx.
 *
 * No FAB on this screen — only the floating tab bar needs clearing, via the
 * same getTabBarTopEdge(theme, insets) helper ProfileScreen.jsx/
 * TransactionDetailScreen.jsx already use.
 */
function ActivitiesScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const styles = createStyles(theme, insets);

  // This hook is the load trigger as well as the read; it is cache-first for
  // the session.
  const {
    activities,
    hasLoaded,
    isLoading,
    isLoadingMore,
    loadError,
    loadMoreError,
    loadMore,
    reload,
  } = useActivities();

  return (
    <View style={styles.flex}>
      <ScreenHeader title="Activities" onBack={() => navigation.goBack()} />

      <FlatList
        // Fabric view-identity guard: FlatList defaults this to true on
        // Android, which attaches and detaches children outside Fabric's
        // own insert/remove instructions and can produce
        // "addViewAt ... child already has a parent" crashes.
        removeClippedSubviews={false}
        data={activities}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        // The store ignores this while a read is in flight or the last page is
        // already held, so a fast scroll cannot stack up requests.
        onEndReached={loadMore}
        onEndReachedThreshold={0.3}
        ListEmptyComponent={
          <ActivitiesPlaceholder
            styles={styles}
            hasLoaded={hasLoaded}
            isLoading={isLoading}
            loadError={loadError}
            onRetry={reload}
          />
        }
        ListFooterComponent={
          <>
            {isLoadingMore ? <Text style={styles.statusText}>Loading more activity…</Text> : null}
            {loadMoreError ? <InlineMessage message={loadMoreError} onRetry={loadMore} /> : null}
          </>
        }
        renderItem={({ item, index }) => (
          // `isLast` suppresses the trailing connector segment so the timeline
          // line does not dangle. It is the last *loaded* row, which is the
          // right answer while more pages exist too: the footer sits below it.
          <ActivityLogItem
            activity={item}
            isLast={index === activities.length - 1}
            // Entries backed by a change-log row open Change Detail
            // (docs/decisions/0027-offline-first-local-cache-and-replay-sync.md §6.6).
            onPress={
              item.relatedChangeLogId
                ? () => navigation.navigate('ChangeDetail', { changeLogId: item.relatedChangeLogId })
                : null
            }
          />
        )}
      />
    </View>
  );
}

/**
 * The states this feed has before it has rows, kept apart for the reason
 * constitution §22 and every other wired list in this app record: **a failed
 * read must never render the empty state.**
 *
 * @param {object} props
 * @param {object} props.styles
 * @param {boolean} props.hasLoaded
 * @param {boolean} props.isLoading
 * @param {string | null} props.loadError
 * @param {() => void} props.onRetry
 */
function ActivitiesPlaceholder({ styles, hasLoaded, isLoading, loadError, onRetry }) {
  if (!hasLoaded && isLoading) {
    return <Text style={styles.statusText}>Loading activity…</Text>;
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
      <IconBadge glyph="⇄" tone="neutral" size="large" />
      {/* Deliberately does not list which actions appear here. Four of the six
          documented event types have no writer in the backend yet
          (`backend/README.md` §17.8 flag 8), so naming them would promise
          entries that cannot arrive. */}
      <Text style={styles.emptyStateText}>
        No activity yet. Shared expenses and settlements will show up here.
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

export default ActivitiesScreen;
