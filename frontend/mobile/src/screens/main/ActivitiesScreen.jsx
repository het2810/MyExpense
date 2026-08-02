import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useTheme } from '../../theme/useTheme';
import { getTabBarTopEdge } from '../../theme/layout';
import { useActivityLogStore } from '../../store/useActivityLogStore';
import ScreenHeader from '../../components/ScreenHeader';
import ActivityLogItem from '../../components/ActivityLogItem';

/**
 * Activities — global, unfiltered activity log screen (docs/decisions/
 * 0008-activity-log-system.md §5, docs/ui/design-system.md §12.4). Reached
 * from Profile's "Activities" preferences row. A plain stack push within
 * ProfileStack.jsx (matching TransactionDetailScreen.jsx's placement — a
 * drill-down, not a modal creation flow), registered as `Activities`.
 *
 * Renders EVERY entry in useActivityLogStore, most-recent-first by
 * construction (the store always prepends — no separate sort needed here),
 * unlike Transaction Detail's ACTIVITY card, which filters down to one
 * transaction. Not wrapped in an outer Card — this screen's entire content
 * IS the activity list, matching how Dashboard's Recent Transactions list
 * isn't itself wrapped in one giant card either.
 *
 * No FAB on this screen — only the floating tab bar needs clearing, via the
 * same getTabBarTopEdge(theme) helper ProfileScreen.jsx/
 * TransactionDetailScreen.jsx already use.
 */
function ActivitiesScreen() {
  const theme = useTheme();
  const navigation = useNavigation();
  const styles = createStyles(theme);

  const activities = useActivityLogStore((state) => state.activities);

  return (
    <View style={styles.flex}>
      <ScreenHeader title="Activities" onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={styles.container}>
        {activities.length > 0 ? (
          activities.map((activity, index) => (
            <ActivityLogItem
              key={activity.id}
              activity={activity}
              isLast={index === activities.length - 1}
            />
          ))
        ) : (
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyText}>
              No activity yet. Actions like editing an expense, saving a split, or creating a
              group will show up here.
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function createStyles(theme) {
  return StyleSheet.create({
    flex: {
      flex: 1,
      backgroundColor: theme.color.background.base,
    },
    container: {
      flexGrow: 1,
      paddingHorizontal: theme.space.xl,
      paddingTop: theme.space.md,
      paddingBottom: getTabBarTopEdge(theme) + theme.space.lg,
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

export default ActivitiesScreen;
