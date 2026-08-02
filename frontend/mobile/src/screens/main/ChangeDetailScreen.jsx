import React from 'react';
import { ScrollView, Text, View, StyleSheet } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../../theme/useTheme';
import { useChangeDetail } from '../../hooks/useChangeDetail';
import { dashboardSummary } from '../../mocks/dashboardMocks';
import ScreenHeader from '../../components/ScreenHeader';
import Card from '../../components/Card';
import InlineMessage from '../../components/InlineMessage';
import ChangeLogEntryItem from '../../components/ChangeLogEntryItem';

const ENTITY_LABELS = {
  transaction: 'Transaction',
  category: 'Category',
  budget_period: 'Budget',
  user_settings: 'Settings',
  contact: 'Contact',
  group: 'Group',
  split_expense: 'Split expense',
  settlement: 'Settlement',
};

/**
 * Change Detail — one change-log row, field by field
 * (docs/decisions/0027-offline-first-local-cache-and-replay-sync.md §6.6).
 * Pushed from the global Activities feed (an entry with `relatedChangeLogId`)
 * and from Transaction Detail's ACTIVITY card. Route param: `changeLogId`.
 */
function ChangeDetailScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const styles = createStyles(theme, insets);
  const navigation = useNavigation();
  const route = useRoute();
  const { entry, isLoading, error, thisDeviceId, reload } = useChangeDetail(
    route.params?.changeLogId,
  );
  const { currencySymbol } = dashboardSummary;

  return (
    <View style={styles.flex}>
      <ScreenHeader title="Change Details" onBack={() => navigation.goBack()} />
      <ScrollView contentContainerStyle={styles.content}>
        {isLoading && !entry ? <Text style={styles.status}>Loading…</Text> : null}
        <InlineMessage message={error} onRetry={reload} />
        {entry ? (
          <Card>
            <Text style={styles.label}>
              {(ENTITY_LABELS[entry.entityType] ?? 'Change').toUpperCase()}
            </Text>
            <ChangeLogEntryItem
              entry={entry}
              currencySymbol={currencySymbol}
              thisDeviceId={thisDeviceId}
              isLast
            />
          </Card>
        ) : null}
      </ScrollView>
    </View>
  );
}

function createStyles(theme, insets) {
  return StyleSheet.create({
    flex: {
      flex: 1,
      backgroundColor: theme.color.background.base,
    },
    content: {
      padding: theme.space.lg,
      paddingBottom: insets.bottom + theme.space.xxxl,
    },
    status: {
      color: theme.color.text.secondary,
      fontSize: theme.type.body.fontSize,
      marginBottom: theme.space.md,
    },
    label: {
      color: theme.color.text.tertiary,
      fontSize: theme.type.label.fontSize,
      fontWeight: theme.type.label.fontWeight,
      letterSpacing: theme.type.label.letterSpacing,
      marginBottom: theme.space.xs,
    },
  });
}

export default ChangeDetailScreen;
